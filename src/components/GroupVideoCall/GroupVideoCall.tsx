import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { ICE_SERVERS } from "@shared/constants";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../ui/button";
import { toast } from "../ui/use-toast";

const GroupVideoCall = ({ channelId }: { channelId: string }) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const user = useQuery(api.users.viewer);

  const [peerConnectionPerUser, setPeerConnections] = useState<
    Record<string, RTCPeerConnection>
  >({});

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const sendSignal = useMutation(api.signaling.sendRoomSignal);
  const answerSignals = useQuery(api.signaling.getSignals, {
    roomId: channelId,
    type: "answer",
  });
  const offerSignals = useQuery(api.signaling.getSignals, {
    roomId: channelId,
    type: "offer",
  });
  const smotherSignal = useMutation(api.signaling.deleteRoomSignal);

  const initLocalStream = async () => {
    let mediaRequests: MediaStreamConstraints = {};

    let devices = await navigator.mediaDevices.enumerateDevices();

    devices.forEach(({ kind }) => {
      if (kind === "videoinput") mediaRequests.video = true;
      if (kind === "audioinput") mediaRequests.audio = true;
    });

    const stream = await navigator.mediaDevices.getUserMedia(mediaRequests);
    setLocalStream(stream);
  };

  const createPeerConnection = (userId: Id<"users">) => {
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    localStream
      ?.getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          roomId: channelId,
          userId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    peerConnection.ontrack = (event) => {
      const remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
      setRemoteStreams((prev) => ({ ...prev, [userId]: remoteStream }));
    };

    return peerConnection;
  };

  const handleJoinCall = async () => {
    const userId = user?._id;

    if (!userId) {
      toast({
        variant: "destructive",
        title: "Not authenticated",
        description: "how did you get here?",
      });
      return;
    }

    const peerConnection = createPeerConnection(userId);
    setPeerConnections((prev) => ({ ...prev, [userId]: peerConnection }));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await sendSignal({
      roomId: channelId,
      userId: userId as Id<"users">,
      sdp: offer.sdp,
      type: "offer",
    });
  };

  useEffect(() => {
    initLocalStream();

    return () => {
      smotherSignal({ roomId: channelId, userId: user!._id });
    };
  }, []);

  useEffect(() => {
    if (!answerSignals) return;

    answerSignals.forEach(async (signal) => {
      let peerConnection = peerConnectionPerUser[signal.userId];
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({
          type: signal.type as RTCSdpType,
          sdp: signal.sdp,
        }),
      );
    });
  }, [answerSignals]);

  useEffect(() => {
    if (!offerSignals || !offerSignals.length) return;
  
    const handleOfferSignals = async () => {
      for (const offer of offerSignals) {
        try {
          // Skip if we already have a peer connection for this user
          if (peerConnectionPerUser[offer.userId]) continue;
  
          // Create a new peer connection
          const peerConnection = createPeerConnection(offer.userId);
          setPeerConnections((prev) => ({
            ...prev,
            [offer.userId]: peerConnection,
          }));
  
          // Validate peer connection state before setting remote description
          if (peerConnection.signalingState !== 'stable') {
            console.warn(`Skipping offer from ${offer.userId}, connection not in stable state`);
            continue;
          }
  
          // Set the remote description (the offer)
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription({
              type: 'offer',
              sdp: offer.sdp,
            })
          );
  
          // Create and set the answer
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          
          // Send the answer signal
          await sendSignal({
            roomId: channelId,
            userId: offer.userId,
            sdp: answer.sdp,
            type: "answer",
          });
        } catch (error) {
          console.error(`Error processing offer from ${offer.userId}:`, error);
          
          // Optional: toast or other error handling
          toast({
            variant: "destructive",
            title: "Call Connection Error",
            description: `Failed to process call from ${offer.userId}`,
          });
        }
      }
    };
  
    handleOfferSignals();
  }, [offerSignals, channelId, peerConnectionPerUser, sendSignal, toast]);

  return (
    <div>
      <h1>Group Video Call</h1>
      <div className="video-container">
        <h3>Local Stream</h3>
        <video
          autoPlay
          playsInline
          ref={(video) => {
            if (video) video.srcObject = localStream;
          }}
        />
        {Object.keys(remoteStreams).map((userId) => (
          <div key={userId}>
            <h3>Remote Stream - {userId}</h3>
            <video
              autoPlay
              playsInline
              ref={(video) => {
                if (video) video.srcObject = remoteStreams[userId];
              }}
            />
          </div>
        ))}
      </div>
      <Button onClick={handleJoinCall}>Join Call</Button>
    </div>
  );
};

export default GroupVideoCall;
