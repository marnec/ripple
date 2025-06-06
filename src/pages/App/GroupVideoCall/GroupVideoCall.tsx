import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

import { ICE_SERVERS } from "@shared/constants";
import uuid4 from "uuid4";
import { api } from "../../../../convex/_generated/api";
import { Button } from "../../../components/ui/button";

const GroupVideoCall = ({ channelId }: { channelId: string }) => {
  const user = useQuery(api.users.viewer);
  
  // Generate unique peerId per component instance
  const peerIdRef = useRef(uuid4());
  const peerId = peerIdRef.current;

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasJoined, sethasJoined] = useState<boolean>(false);

  const peerConnectionPerPeer = useRef<Record<string, RTCPeerConnection>>({});
  const processedSignals = useRef<Set<string>>(new Set());

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});

  const iceCandidateQueue = useRef<Record<string, RTCIceCandidate[]>>({});

  // Memoize query parameters to prevent unnecessary re-renders
  const queryParams = useMemo(() => ({
    roomId: channelId,
    excludePeer: peerId,
  }), [channelId, peerId]);

  const iceCandidateSignals = useQuery(api.signaling.getIceCandidates, queryParams);

  const sendSignal = useMutation(api.signaling.sendRoomSignal);

  const answerSignals = useQuery(api.signaling.getAnswers, {
    roomId: channelId,
  });

  const offerSignals = useQuery(api.signaling.getOffers, {
    roomId: channelId,
  });

  const smotherSignal = useMutation(api.signaling.deleteRoomSignal);

  const initLocalStream = useCallback(async () => {
    try {
      let mediaRequests: MediaStreamConstraints = {};

      let devices = await navigator.mediaDevices.enumerateDevices();

      devices.forEach(({ kind }) => {
        if (kind === "videoinput") mediaRequests.video = true;
        if (kind === "audioinput") mediaRequests.audio = true;
      });

      const stream = await navigator.mediaDevices.getUserMedia(mediaRequests);
      setLocalStream(stream);
    } catch (error) {
      console.error("Failed to get user media:", error);
    }
  }, []);

  const createPeerConnection = useCallback((remotePeerId: string) => {
    console.log(`creating peer connection for remote peer=${remotePeerId}`);

    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendSignal({
        roomId: channelId,
        peerId,
        userId: user?._id!,
        candidate: event.candidate.toJSON(),
        type: "ice-candidate",
      });
    };

    // Add local stream tracks to the peer connection
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    }

    peerConnection.ontrack = (event) => {
      console.log(`Received track from ${remotePeerId}`);
      const [remoteStream] = event.streams;
      if (remoteStream) {
        setRemoteStreams((prev) => ({ ...prev, [remotePeerId]: remoteStream }));
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(
        `Peer connection with ${remotePeerId} state: ${peerConnection.connectionState}`
      );
      
      if (peerConnection.connectionState === 'failed' || 
          peerConnection.connectionState === 'disconnected') {
        // Remove remote stream if connection fails
        setRemoteStreams((prev) => {
          const newStreams = { ...prev };
          delete newStreams[remotePeerId];
          return newStreams;
        });
      }
    };

    return peerConnection;
  }, [localStream, channelId, peerId, user?._id, sendSignal]);

  const leaveCall = useCallback(async () => {
    console.log("leaving call");
    sethasJoined(false);
    
    try {
      // Close all peer connections
      Object.values(peerConnectionPerPeer.current).forEach(pc => {
        pc.close();
      });
      peerConnectionPerPeer.current = {};
      
      // Clear remote streams
      setRemoteStreams({});
      
      // Clear processed signals
      processedSignals.current.clear();
      
      // Delete signals from server
      await smotherSignal({ roomId: channelId, peerId: peerId });
      
      console.log("Successfully left call");
    } catch (error) {
      console.error("Error leaving call:", error);
    }
  }, [channelId, peerId, smotherSignal]);

  const joinCall = useCallback(async () => {
    console.log("joining call");
    const userId = user?._id;
    if (!userId || !localStream) {
      console.error("Missing user ID or local stream");
      return;
    }

    try {
      // Process existing offers
      for (let { sdp, peerId: offererId } of offerSignals || []) {
        const signalId = `offer-${offererId}-${sdp}`;
        if (processedSignals.current.has(signalId)) continue;
        
        console.log(`Processing offer from ${offererId}`);
        processedSignals.current.add(signalId);
        
        let offeredPeerConnection = createPeerConnection(offererId);

        let remoteDescription = new RTCSessionDescription({
          type: "offer",
          sdp,
        });

        await offeredPeerConnection.setRemoteDescription(remoteDescription);

        // Process queued ICE candidates
        const queuedCandidates = iceCandidateQueue.current[offererId] || [];
        for (let iceCandidate of queuedCandidates) {
          console.log(`Adding queued ICE candidate for ${offererId}`);
          await offeredPeerConnection.addIceCandidate(iceCandidate);
        }
        iceCandidateQueue.current[offererId] = [];

        let answer = await offeredPeerConnection.createAnswer();
        await offeredPeerConnection.setLocalDescription(answer);

        await sendSignal({
          type: "answer",
          roomId: channelId,
          sdp: answer.sdp,
          peerId,
          userId,
          candidate: offererId,
        });

        peerConnectionPerPeer.current[offererId] = offeredPeerConnection;
      }

      // Create and send our own offer
      let clientPeerConnection = createPeerConnection(userId);

      const offer = await clientPeerConnection.createOffer();
      await clientPeerConnection.setLocalDescription(offer);

      await sendSignal({
        roomId: channelId,
        peerId,
        userId,
        sdp: offer.sdp,
        type: "offer",
      });

      sethasJoined(true);
      console.log("Successfully joined call");
    } catch (error) {
      console.error("Error joining call:", error);
    }
  }, [user?._id, localStream, offerSignals, createPeerConnection, channelId, peerId, sendSignal]);

  useEffect(() => {
    initLocalStream();

    return () => {
      leaveCall();
    };
  }, [initLocalStream, leaveCall]);

  useEffect(() => {
    if (!hasJoined || !answerSignals) return;

    const connectToAnswerer = async () => {
      console.log("Processing answers to my offer");

      for (let { peerId: answererId, sdp } of answerSignals) {
        const signalId = `answer-${answererId}-${sdp}`;
        if (processedSignals.current.has(signalId)) continue;
        
        console.log(`Processing answer from ${answererId}`);
        processedSignals.current.add(signalId);

        if (answererId in peerConnectionPerPeer.current) {
          console.log(`Peer connection already exists for ${answererId}`);
          continue;
        }

        try {
          let answeredPeerConnection = createPeerConnection(answererId);

          let remoteDescription = new RTCSessionDescription({
            type: "answer",
            sdp: sdp,
          });

          await answeredPeerConnection.setRemoteDescription(remoteDescription);

          console.log(`Set remote description for ${answererId}`);

          // Process queued ICE candidates
          const queuedCandidates = iceCandidateQueue.current[answererId] || [];
          for (let iceCandidate of queuedCandidates) {
            console.log(`Adding queued ICE candidate for ${answererId}`);
            await answeredPeerConnection.addIceCandidate(iceCandidate);
          }
          iceCandidateQueue.current[answererId] = [];

          peerConnectionPerPeer.current[answererId] = answeredPeerConnection;
        } catch (error) {
          console.error(`Error processing answer from ${answererId}:`, error);
        }
      }
    };

    connectToAnswerer();
  }, [answerSignals, hasJoined, createPeerConnection]);

  useEffect(() => {
    if (!iceCandidateSignals) return;

    iceCandidateSignals.forEach((signal) => {
      const signalId = `ice-${signal.peerId}-${JSON.stringify(signal.candidate)}`;
      if (processedSignals.current.has(signalId)) return;
      
      processedSignals.current.add(signalId);
      
      try {
        let iceCandidate = new RTCIceCandidate(signal.candidate);
        const targetPeerConnection = peerConnectionPerPeer.current[signal.peerId];

        if (!targetPeerConnection?.remoteDescription) {
          console.log(`Queueing ICE candidate for ${signal.peerId}`);
          if (!(signal.peerId in iceCandidateQueue.current)) {
            iceCandidateQueue.current[signal.peerId] = [];
          }
          iceCandidateQueue.current[signal.peerId].push(iceCandidate);
          return;
        }

        console.log(`Adding ICE candidate to ${signal.peerId} peer connection`);
        targetPeerConnection.addIceCandidate(iceCandidate);
      } catch (error) {
        console.error(`Error processing ICE candidate from ${signal.peerId}:`, error);
      }
    });
  }, [iceCandidateSignals]);

  // Memoize connected peers count to prevent unnecessary re-renders
  const connectedPeersCount = useMemo(() => {
    return Object.keys(peerConnectionPerPeer.current).length;
  }, [remoteStreams]);

  return (
    <div style={{ padding: '16px' }}>
      <h1 style={{ marginBottom: '20px' }}>Group Video Call</h1>
      <div className="video-container" style={{ marginBottom: '20px' }}>
        <h3>Local Stream</h3>
        <video
          autoPlay
          playsInline
          muted
          style={{ 
            width: '100%', 
            maxWidth: '300px', 
            height: 'auto',
            aspectRatio: '4/3',
            border: '1px solid #ccc',
            borderRadius: '8px'
          }}
          ref={(video) => {
            if (video && localStream) video.srcObject = localStream;
          }}
        />
        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <div key={peerId} style={{ marginTop: '16px' }}>
            <h3>Remote Stream - {peerId}</h3>
            <video
              autoPlay
              playsInline
              style={{ 
                width: '100%', 
                maxWidth: '300px', 
                height: 'auto',
                aspectRatio: '4/3',
                border: '1px solid #ccc',
                borderRadius: '8px'
              }}
              ref={(video) => {
                if (video && stream) video.srcObject = stream;
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        marginBottom: '16px',
        flexWrap: 'wrap'
      }}>
        <Button onClick={joinCall} disabled={hasJoined || !localStream}>
          Join Call
        </Button>
        <Button onClick={leaveCall} disabled={!hasJoined}>
          Leave Call
        </Button>
      </div>
      <div style={{ 
        fontSize: '14px', 
        color: '#666',
        backgroundColor: '#f5f5f5',
        padding: '12px',
        borderRadius: '6px',
        lineHeight: '1.4'
      }}>
        <div><strong>Peer ID:</strong> {peerId.slice(0, 8)}...</div>
        <div><strong>Connected peers:</strong> {connectedPeersCount}</div>
        <div><strong>Status:</strong> {hasJoined ? '🟢 Joined' : '🔴 Not joined'}</div>
      </div>
    </div>
  );
};

export default GroupVideoCall;
