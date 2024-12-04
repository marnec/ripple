import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";

export interface VideoCallProps {
  roomId: string;
}

const VideoCall = ({ roomId }: VideoCallProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const sendSignal = useMutation(api.signaling.sendSignal);
  const roomSignals = useQuery(api.signaling.getSignals, { roomId });

  useEffect(() => {
    const initLocalStream = async () => {
      let mediaRequests: MediaStreamConstraints = {};

      let devices = await navigator.mediaDevices.enumerateDevices();

      devices.forEach(({ kind }) => {
        if (kind === "videoinput") mediaRequests.video = true;
        if (kind === "audioinput") mediaRequests.audio = true;
      });

      const stream = await navigator.mediaDevices.getUserMedia(mediaRequests);

      setLocalStream(stream);

      if (peerConnectionRef.current) {
        stream
          .getTracks()
          .forEach((track) =>
            peerConnectionRef.current?.addTrack(track, stream),
          );
      }
    };

    initLocalStream().catch((error) => console.error(error));
  }, []);

  useEffect(() => {
    const handleSignal = async () => {
      if (!roomSignals) return;

      roomSignals.forEach((signal) => {
        if (signal.signal.type === "offer") {
          handleOffer(signal.signal.data);
        } else if (signal.signal.type === "answer") {
          handleAnswer(signal.signal.data);
        } else if (signal.signal.type === "ice-candidate") {
          handleIceCandidate(signal.signal.data);
        }
      });
    };

    handleSignal();
  }, [roomId, roomSignals]);

  const handleOffer = async (offer: any) => {
    const peerConnection = new RTCPeerConnection();
    peerConnectionRef.current = peerConnection;

    localStream?.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await sendSignal({ roomId, signal: { type: "answer", data: answer } });

    peerConnection.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({
          roomId,
          signal: { type: "ice-candidate", data: event.candidate },
        });
      }
    };
  };

  const handleAnswer = async (answer: any) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
    }
  };

  const handleIceCandidate = async (candidate: any) => {
    if (peerConnectionRef.current) {
      await peerConnectionRef.current.addIceCandidate(
        new RTCIceCandidate(candidate),
      );
    }
  };

  return (
    <div>
      <h2>Video Call</h2>
      <video
        autoPlay
        muted
        ref={(video) => video && (video.srcObject = localStream)}
      />
      <video
        autoPlay
        ref={(video) => video && (video.srcObject = remoteStream)}
      />
    </div>
  );
};

export default VideoCall;
