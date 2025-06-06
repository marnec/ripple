import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

import { ICE_SERVERS } from "@shared/constants";
import uuid4 from "uuid4";
import { api } from "../../../../convex/_generated/api";
import { Button } from "../../../components/ui/button";

interface PeerData {
  connection: RTCPeerConnection;
  stream?: MediaStream;
}

const GroupVideoCall = ({ channelId }: { channelId: string }) => {
  const user = useQuery(api.users.viewer);
  
  // Generate unique peerId per component instance
  const peerIdRef = useRef(uuid4());
  const peerId = peerIdRef.current;

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasJoined, setHasJoined] = useState<boolean>(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  // Store peer connections and processed signals
  const peersRef = useRef<Record<string, PeerData>>({});
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidate[]>>({});

  // Video element refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefsRef = useRef<Record<string, HTMLVideoElement>>({});

  // Memoized query parameters
  const queryParams = useMemo(() => ({
    roomId: channelId,
    excludePeer: peerId,
  }), [channelId, peerId]);

  const roomQueryParams = useMemo(() => ({
    roomId: channelId,
  }), [channelId]);

  // Convex queries
  const offerSignals = useQuery(api.signaling.getOffers, roomQueryParams);
  const answerSignals = useQuery(api.signaling.getAnswers, roomQueryParams);
  const iceCandidateSignals = useQuery(api.signaling.getIceCandidates, queryParams);

  // Convex mutations
  const sendSignal = useMutation(api.signaling.sendRoomSignal);
  const deleteSignal = useMutation(api.signaling.deleteRoomSignal);

  // Initialize local media stream
  const initLocalStream = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      console.log("Available devices:", devices);
      
      const mediaRequests: MediaStreamConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user"
        },
        audio: true
      };

      // Check if we have video/audio devices
      const hasVideo = devices.some(device => device.kind === "videoinput");
      const hasAudio = devices.some(device => device.kind === "audioinput");
      
      if (!hasVideo) mediaRequests.video = false;
      if (!hasAudio) mediaRequests.audio = false;

      console.log("Requesting media with constraints:", mediaRequests);
      const stream = await navigator.mediaDevices.getUserMedia(mediaRequests);
      
      console.log("Got local stream with tracks:", {
        video: stream.getVideoTracks().length,
        audio: stream.getAudioTracks().length,
        tracks: stream.getTracks().map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState }))
      });
      
      setLocalStream(stream);
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Failed to get user media:", error);
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback((remotePeerId: string): RTCPeerConnection => {
    console.log(`Creating peer connection for ${remotePeerId}`);
    
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Add local stream tracks
    if (localStream) {
      const tracks = localStream.getTracks();
      console.log(`Adding ${tracks.length} tracks to peer connection for ${remotePeerId}:`, 
        tracks.map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState }))
      );
      
      tracks.forEach((track) => {
        const sender = peerConnection.addTrack(track, localStream);
        console.log(`Added ${track.kind} track, sender:`, sender);
      });
    } else {
      console.warn(`No local stream available when creating peer connection for ${remotePeerId}`);
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && user?._id) {
        sendSignal({
          roomId: channelId,
          peerId,
          userId: user._id,
          candidate: event.candidate.toJSON(),
          type: "ice-candidate",
        });
      }
    };

    // Handle incoming media tracks
    peerConnection.ontrack = (event) => {
      console.log(`Received track from ${remotePeerId}`, {
        track: event.track,
        streams: event.streams,
        trackKind: event.track.kind,
        trackEnabled: event.track.enabled,
        trackReadyState: event.track.readyState
      });
      
      const [remoteStream] = event.streams;
      
      if (remoteStream) {
        const tracks = remoteStream.getTracks();
        console.log(`Remote stream from ${remotePeerId} has ${tracks.length} tracks:`, 
          tracks.map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState }))
        );
        
        if (tracks.length > 0) {
          console.log(`Setting remote stream for ${remotePeerId}`);
          
          // Update peer data
          if (peersRef.current[remotePeerId]) {
            peersRef.current[remotePeerId].stream = remoteStream;
          }
          
          // Update state
          setRemoteStreams(prev => ({ ...prev, [remotePeerId]: remoteStream }));
          
          // Update video element
          const videoElement = remoteVideoRefsRef.current[remotePeerId];
          if (videoElement) {
            console.log(`Assigning remote stream to video element for ${remotePeerId}`);
            videoElement.srcObject = remoteStream;
            videoElement.play().catch(err => 
              console.log(`Auto-play prevented for ${remotePeerId}:`, err)
            );
          }
        } else {
          console.warn(`Remote stream from ${remotePeerId} has no tracks`);
        }
      } else {
        console.warn(`No remote stream received from ${remotePeerId}`);
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(`Peer ${remotePeerId} connection state: ${peerConnection.connectionState}`);
      
      if (['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState)) {
        // Clean up
        delete peersRef.current[remotePeerId];
        setRemoteStreams(prev => {
          const newStreams = { ...prev };
          delete newStreams[remotePeerId];
          return newStreams;
        });
        delete remoteVideoRefsRef.current[remotePeerId];
      }
    };

    return peerConnection;
  }, [localStream, channelId, peerId, user?._id, sendSignal]);

  // Process queued ICE candidates
  const processQueuedIceCandidates = useCallback(async (remotePeerId: string) => {
    const peerConnection = peersRef.current[remotePeerId]?.connection;
    const queuedCandidates = iceCandidateQueueRef.current[remotePeerId] || [];
    
    if (peerConnection && peerConnection.remoteDescription && queuedCandidates.length > 0) {
      console.log(`Processing ${queuedCandidates.length} queued ICE candidates for ${remotePeerId}`);
      
      for (const candidate of queuedCandidates) {
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (error) {
          console.error(`Error adding ICE candidate for ${remotePeerId}:`, error);
        }
      }
      
      iceCandidateQueueRef.current[remotePeerId] = [];
    }
  }, []);

  // Handle incoming offers (when someone else creates an offer, we need to answer)
  useEffect(() => {
    if (!hasJoined || !offerSignals || !user?._id) return;

    offerSignals.forEach(async ({ sdp, peerId: offererId }) => {
      const signalId = `offer-${offererId}-${sdp?.substring(0, 50) || ''}`;
      
      if (processedSignalsRef.current.has(signalId) || offererId === peerId) return;
      processedSignalsRef.current.add(signalId);

      console.log(`Processing offer from ${offererId}`);

      try {
        // Create peer connection if it doesn't exist
        if (!peersRef.current[offererId]) {
          const peerConnection = createPeerConnection(offererId);
          peersRef.current[offererId] = { connection: peerConnection };
          
          // If local stream is available but wasn't added during creation, add it now
          if (localStream && peerConnection.getSenders().length === 0) {
            console.log(`Adding local stream tracks to newly created peer connection for ${offererId}`);
            localStream.getTracks().forEach((track) => {
              peerConnection.addTrack(track, localStream);
            });
          }
        }

        const peerConnection = peersRef.current[offererId].connection;
        
        // Set remote description
        await peerConnection.setRemoteDescription(new RTCSessionDescription({
          type: "offer",
          sdp,
        }));

        // Process queued ICE candidates
        await processQueuedIceCandidates(offererId);

        // Create and send answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        if (answer.sdp) {
          await sendSignal({
            type: "answer",
            roomId: channelId,
            sdp: answer.sdp,
            peerId,
            userId: user._id,
            candidate: offererId,
          });
        }

        console.log(`Sent answer to ${offererId}`);
      } catch (error) {
        console.error(`Error processing offer from ${offererId}:`, error);
      }
    });
  }, [hasJoined, offerSignals, user?._id, peerId, channelId, createPeerConnection, processQueuedIceCandidates, sendSignal]);

  // Handle incoming answers (when someone answers our offer)
  useEffect(() => {
    if (!hasJoined || !answerSignals) return;

    answerSignals.forEach(async ({ peerId: answererId, sdp, candidate }) => {
      const signalId = `answer-${answererId}-${sdp?.substring(0, 50) || ''}`;
      
      if (processedSignalsRef.current.has(signalId) || candidate !== user?._id) return;
      processedSignalsRef.current.add(signalId);

      console.log(`Processing answer from ${answererId}`);

      try {
        const peerData = peersRef.current[answererId];
        if (!peerData) {
          console.warn(`No peer connection found for ${answererId}`);
          return;
        }

        // Set remote description
        await peerData.connection.setRemoteDescription(new RTCSessionDescription({
          type: "answer",
          sdp,
        }));

        // Process queued ICE candidates
        await processQueuedIceCandidates(answererId);

        console.log(`Processed answer from ${answererId}`);
      } catch (error) {
        console.error(`Error processing answer from ${answererId}:`, error);
      }
    });
  }, [hasJoined, answerSignals, user?._id, processQueuedIceCandidates]);

  // Handle ICE candidates
  useEffect(() => {
    if (!iceCandidateSignals) return;

    iceCandidateSignals.forEach(({ peerId: candidatePeerId, candidate }) => {
      const signalId = `ice-${candidatePeerId}-${JSON.stringify(candidate)}`;
      
      if (processedSignalsRef.current.has(signalId)) return;
      processedSignalsRef.current.add(signalId);

      try {
        const iceCandidate = new RTCIceCandidate(candidate);
        const peerConnection = peersRef.current[candidatePeerId]?.connection;

        if (!peerConnection || !peerConnection.remoteDescription) {
          // Queue the candidate
          console.log(`Queueing ICE candidate for ${candidatePeerId}`);
          if (!iceCandidateQueueRef.current[candidatePeerId]) {
            iceCandidateQueueRef.current[candidatePeerId] = [];
          }
          iceCandidateQueueRef.current[candidatePeerId].push(iceCandidate);
          return;
        }

        console.log(`Adding ICE candidate for ${candidatePeerId}`);
        peerConnection.addIceCandidate(iceCandidate);
      } catch (error) {
        console.error(`Error processing ICE candidate from ${candidatePeerId}:`, error);
      }
    });
  }, [iceCandidateSignals]);

  // Join call
  const joinCall = useCallback(async () => {
    if (!user?._id || !localStream) {
      console.error("Missing user ID or local stream");
      return;
    }

    console.log("Joining call");
    
    try {
      setHasJoined(true);

      // Small delay to ensure state is updated before processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create and send offer to initiate connections
      const myPeerConnection = createPeerConnection(user._id);
      const offer = await myPeerConnection.createOffer();
      await myPeerConnection.setLocalDescription(offer);

      if (offer.sdp) {
        await sendSignal({
          roomId: channelId,
          peerId,
          userId: user._id,
          sdp: offer.sdp,
          type: "offer",
        });
      }

      console.log("Successfully joined call and sent offer");
    } catch (error) {
      console.error("Error joining call:", error);
      setHasJoined(false);
    }
  }, [user?._id, localStream, createPeerConnection, channelId, peerId, sendSignal]);

  // Leave call
  const leaveCall = useCallback(async () => {
    console.log("Leaving call");
    
    try {
      setHasJoined(false);
      
      // Close all peer connections
      Object.values(peersRef.current).forEach(({ connection }) => {
        connection.close();
      });
      
      // Clear all refs and state
      peersRef.current = {};
      processedSignalsRef.current.clear();
      iceCandidateQueueRef.current = {};
      remoteVideoRefsRef.current = {};
      setRemoteStreams({});
      
      // Delete our signals from server
      await deleteSignal({ roomId: channelId, peerId });
      
      console.log("Successfully left call");
    } catch (error) {
      console.error("Error leaving call:", error);
    }
  }, [channelId, peerId, deleteSignal]);

  // Initialize on mount
  useEffect(() => {
    initLocalStream();
    return () => {
      leaveCall();
    };
  }, [initLocalStream, leaveCall]);

  // Update local video when stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Re-add tracks to existing peer connections when local stream changes
  useEffect(() => {
    if (!localStream) return;

    console.log("Local stream updated, checking existing peer connections...");
    
    Object.entries(peersRef.current).forEach(([remotePeerId, peerData]) => {
      const senders = peerData.connection.getSenders();
      console.log(`Peer ${remotePeerId} has ${senders.length} senders`);
      
      // Check if we need to add tracks
      const localTracks = localStream.getTracks();
      localTracks.forEach(track => {
        const existingSender = senders.find(sender => 
          sender.track && sender.track.kind === track.kind
        );
        
        if (!existingSender) {
          console.log(`Adding missing ${track.kind} track to peer ${remotePeerId}`);
          peerData.connection.addTrack(track, localStream);
        }
      });
    });
  }, [localStream]);

  return (
    <div style={{ padding: '16px' }}>
      <h1 style={{ marginBottom: '20px' }}>Group Video Call</h1>
      
      <div className="video-container" style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3>Local Stream</h3>
          <video
            ref={localVideoRef}
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
          />
        </div>
        
        {Object.entries(remoteStreams).map(([remotePeerId, stream]) => (
          <div key={remotePeerId} style={{ marginBottom: '16px' }}>
            <h3>Remote Stream - {remotePeerId.slice(0, 8)}...</h3>
            <video
              ref={(video) => {
                if (video) {
                  remoteVideoRefsRef.current[remotePeerId] = video;
                  video.srcObject = stream;
                  video.play().catch(err => 
                    console.log(`Auto-play prevented for ${remotePeerId}:`, err)
                  );
                }
              }}
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
        <div><strong>Connected peers:</strong> {Object.keys(remoteStreams).length}</div>
        <div><strong>Status:</strong> {hasJoined ? '🟢 Joined' : '🔴 Not joined'}</div>
        <div><strong>Local stream:</strong> {localStream ? '✅ Ready' : '❌ Not ready'}</div>
      </div>
    </div>
  );
};

export default GroupVideoCall;
