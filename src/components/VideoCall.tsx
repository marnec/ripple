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

      console.log(stream);

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
    if (!peerConnectionRef.current) {
      peerConnectionRef.current = new RTCPeerConnection();
      localStream
        ?.getTracks()
        .forEach((track) =>
          peerConnectionRef.current?.addTrack(track, localStream),
        );
    }
    await peerConnectionRef.current.setRemoteDescription(
      new RTCSessionDescription(offer),
    );
    const answer = await peerConnectionRef.current.createAnswer();
    await peerConnectionRef.current.setLocalDescription(answer);
    await sendSignal({ roomId, signal: { type: "answer", data: answer } });
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

  useEffect(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            roomId,
            signal: { type: "ice-candidate", data: event.candidate },
          });
        }
      };

      peerConnectionRef.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };
    }
  }, [sendSignal]);

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
