import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { ICE_SERVERS } from "@shared/constants";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../ui/button";

const GroupVideoCall = ({ channelId }: { channelId: string }) => {
  const user = useQuery(api.users.viewer);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasJoined, sethasJoined] = useState<boolean>(false);

  const [peerConnectionPerUser] = useState<Record<string, RTCPeerConnection>>(
    {},
  );

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});

  const iceCandidateQueue: Record<string, RTCIceCandidate[]> = {};

  const iceCandidateSignals = useQuery(api.signaling.getIceCandidates, {
    roomId: channelId,
  });

  const sendSignal = useMutation(api.signaling.sendRoomSignal);

  const answerSignals = useQuery(api.signaling.getAnswers, {
    roomId: channelId,
  });

  const offerSignals = useQuery(api.signaling.getOffers, {
    roomId: channelId,
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
    console.log(`creating peer connection for local peer=${userId}`);

    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendSignal({
        roomId: channelId,
        userId,
        candidate: event.candidate.toJSON(),
        type: "ice-candidate",
      });
    };

    localStream
      ?.getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      const remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
      setRemoteStreams((prev) => ({ ...prev, [userId]: remoteStream }));
    };

    return peerConnection;
  };

  const leaveCall = async () => {
    console.log("leaving call");
    sethasJoined(false);
    let deleted = await smotherSignal({ roomId: channelId, userId: user!._id });
    console.log(`deleted=${deleted} signals`);
  };

  const joinCall = async () => {
    console.log("joininig call");
    const userId = user?._id;
    if (!userId) return;

    for (let { sdp, userId: offererId } of offerSignals || []) {
      let offeredPeerConnection = createPeerConnection(offererId);

      let remoteDescription = new RTCSessionDescription({
        type: "offer",
        sdp,
      });

      await offeredPeerConnection.setRemoteDescription(remoteDescription);

      for (let iceCandidate of iceCandidateQueue[offererId] || []) {
        offeredPeerConnection.addIceCandidate(iceCandidate);
      }

      let answer = await offeredPeerConnection.createAnswer();
      await offeredPeerConnection.setLocalDescription(answer);

      await sendSignal({
        type: "answer",
        roomId: channelId,
        userId,
        candidate: offererId,
      });

      peerConnectionPerUser[offererId] = offeredPeerConnection;
    }

    let clientPeerConnection = createPeerConnection(userId);

    const offer = await clientPeerConnection.createOffer();
    await clientPeerConnection.setLocalDescription(offer);
    peerConnectionPerUser[userId] = clientPeerConnection;

    await sendSignal({
      roomId: channelId,
      userId,
      sdp: offer.sdp,
      type: "offer",
    });

    sethasJoined(true);
  };

  useEffect(() => {
    initLocalStream();

    return () => {
      leaveCall();
    };
  }, []);

  useEffect(() => {
    if (!hasJoined) return;
    if (!answerSignals) return;

    const connectToAnswerer = async () => {
      for (let answer of answerSignals) {
        if (answer.userId in peerConnectionPerUser) return;

        let answeredPeerConnection = createPeerConnection(answer.userId);

        let remoteDescription = new RTCSessionDescription({
          type: "answer",
          sdp: answer.sdp,
        });

        await answeredPeerConnection.setRemoteDescription(remoteDescription);

        for (let iceCandidate of iceCandidateQueue[answer.userId] || []) {
          answeredPeerConnection.addIceCandidate(iceCandidate);
        }

        peerConnectionPerUser[answer.userId] = answeredPeerConnection;
      }
    };

    connectToAnswerer();
  }, [answerSignals]);

  useEffect(() => {
    if (!iceCandidateSignals) return;

    iceCandidateSignals.forEach((signal) => {
      // Find the correct peer connection
      let iceCandidate = new RTCIceCandidate(signal.candidate);
      const targetPeerConnection = peerConnectionPerUser[signal.userId];

      if (!targetPeerConnection?.remoteDescription) {
        if (!(signal.userId in iceCandidateQueue)) {
          iceCandidateQueue[signal.userId] = [];
        }

        iceCandidateQueue[signal.userId].push(iceCandidate);
        return;
      }

      targetPeerConnection.addIceCandidate(iceCandidate);
    });
  }, [iceCandidateSignals]);

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
      <Button onClick={joinCall} disabled={hasJoined}>
        Join Call
      </Button>
      <Button onClick={leaveCall} disabled={!hasJoined}>
        Leave Call
      </Button>
    </div>
  );
};

export default GroupVideoCall;
