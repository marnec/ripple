import { ICE_SERVERS } from "@shared/constants";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Doc, Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";

export interface VideoCallProps {
  roomId: string;
}

const VideoCall = ({ roomId }: VideoCallProps) => {
  const user = useQuery(api.users.viewer);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerConnection] = useState(new RTCPeerConnection(ICE_SERVERS));
  const [joined, setJoined] = useState<boolean>(false);
  const sendSignal = useMutation(api.signaling.sendRoomSignal);
  const smotherSignal = useMutation(api.signaling.deleteRoomSignal);
  const sendCandidate = useMutation(api.signaling.sendCandidate);
  const offerSignals = useQuery(api.signaling.getSignals, {
    roomId,
    type: "offer",
  });
  const answerSignals = useQuery(api.signaling.getSignals, {
    roomId,
    type: "answer",
  });

  const initLocalStream = async () => {
    let mediaRequests: MediaStreamConstraints = {};

    let devices = await navigator.mediaDevices.enumerateDevices();

    devices.forEach(({ kind }) => {
      if (kind === "videoinput") mediaRequests.video = true;
      if (kind === "audioinput") mediaRequests.audio = true;
    });

    const stream = await navigator.mediaDevices.getUserMedia(mediaRequests);
    setLocalStream(stream);

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });
  };

  const createRoomOffer = async () => {
    const offerDescription = await peerConnection.createOffer();

    await peerConnection.setLocalDescription(offerDescription);

    if (!offerDescription.sdp) return;

    const signal = {
      roomId,
      userId: user?._id as Id<"users">,
      sdp: offerDescription.sdp,
      type: offerDescription.type,
      candidates: [] as any[],
    } satisfies Omit<Doc<"signals">, "_id" | "_creationTime">;

    const signalId = await sendSignal(signal);

    peerConnection.onicecandidate = (event) => {
      console.log("Ice candidate event (offer)", event);
      if (!event.candidate) return;
      sendCandidate({ id: signalId, candidate: event.candidate.toJSON() });
    };
  };

  const removeRoomOffer = () => {
    smotherSignal({
      roomId,
      userId: user?._id as Id<"users">,
      type: "offer",
    });
  };

  useEffect(() => {
    // createRoomOffer();
    return removeRoomOffer;
  }, []);

  useEffect(() => {
    if (!answerSignals) return;
    console.log("answerSignalChanged", answerSignals);
    for (let answer of answerSignals) {
      // this is not a good check for many to many connections.
      // I need a Record<userId, PeerConnection>
      // but I still don't know exactly how to that data structure
      if (!peerConnection.currentRemoteDescription && answer) {
        let { type, sdp } = answer as RTCSessionDescriptionInit;
        peerConnection.setRemoteDescription({ type, sdp });
      }

      // here I'm adding all candidates in answer.candidates each time something here changes
      // I don't have a way to track what candidates are new and neither what type of change
      // has happened, so I'll need to get creative here to avoid adding many duplicate candidates
      for (let candidate of answer.candidates) {
        let iceCandidate = new RTCIceCandidate(candidate);
        peerConnection.addIceCandidate(iceCandidate);
      }

      setRemoteStream(new MediaStream());
      peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remoteStream?.addTrack(track);
        });
      };
    }
  }, [answerSignals]);

  const answerOffer = async (signal: Doc<"signals">) => {
    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendCandidate({ id: signal._id, candidate: event.candidate.toJSON() });
    };

    let { type, sdp } = signal as RTCSessionDescriptionInit;
    peerConnection.setRemoteDescription({ type, sdp });

    const answerDesc = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answerDesc);
    let userId = user?._id as Id<"users">;

    const answer = {
      roomId,
      userId,
      sdp: answerDesc.sdp!,
      type: answerDesc.type,
      candidates: [],
    } satisfies Omit<Doc<"signals">, "_id" | "_creationTime">;

    await sendSignal(answer);
  };

  const joinPopulatedRoom = () => {
    if (!offerSignals) return;

    setJoined(true);

    for (let offer of offerSignals) {
      answerOffer(offer);
    }
  };

  useEffect(() => {
    if (!joined || !offerSignals) return;

    for (let offer of offerSignals) {
      for (let candidate of offer.candidates) {
        let iceCandidate = new RTCIceCandidate(candidate);
        peerConnection.addIceCandidate(iceCandidate);
      }
    }
  }, [offerSignals]);

  return (
    <>
      <div className="videos">
        <span>
          <h3>Local Stream</h3>
          <video
            autoPlay
            playsInline
            ref={(video) => {
              video && (video.srcObject = localStream);
            }}
          ></video>
        </span>
        <span>
          <h3>Remote Stream</h3>
          <video
            autoPlay
            playsInline
            ref={(video) => {
              video && (video.srcObject = remoteStream);
            }}
          ></video>
        </span>
      </div>

      <Button onClick={initLocalStream}>Start webcam</Button>
      <h2>2. Create a new Call</h2>
      <Button onClick={createRoomOffer}>Create Call (offer)</Button>

      <Button
        onClick={joinPopulatedRoom}
        disabled={!offerSignals?.length || joined}
      >
        Answer
      </Button>

      <Button disabled={!joined} onClick={() => setJoined(false)}>
        Hangup
      </Button>
    </>
  );
};

export default VideoCall;
