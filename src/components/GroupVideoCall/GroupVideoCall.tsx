import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { ICE_SERVERS } from "@shared/constants";
import uuid4 from "uuid4";
import { api } from "../../../convex/_generated/api";
import { Button } from "../ui/button";

const peerId = uuid4();

const GroupVideoCall = ({ channelId }: { channelId: string }) => {
  const user = useQuery(api.users.viewer);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasJoined, sethasJoined] = useState<boolean>(false);

  const [peerConnectionPerPeer] = useState<Record<string, RTCPeerConnection>>(
    {},
  );

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});

  const iceCandidateQueue: Record<string, RTCIceCandidate[]> = {};

  const iceCandidateSignals = useQuery(api.signaling.getIceCandidates, {
    roomId: channelId,
    excludePeer: peerId,
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

  const createPeerConnection = (peerId: string) => {
    console.log(`creating peer connection for local peer=${peerId}`);

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

    localStream
      ?.getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      const remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
      setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
    };

    return peerConnection;
  };

  const leaveCall = async () => {
    console.log("leaving call");
    sethasJoined(false);
    let deleted = await smotherSignal({ roomId: channelId, peerId: peerId });
    for (let user in peerConnectionPerPeer) {
      peerConnectionPerPeer[user].close();
    }
    console.log(`deleted=${deleted} signals`);
  };

  const joinCall = async () => {
    console.log("joininig call");
    const userId = user?._id;
    if (!userId) return;

    for (let { sdp, peerId: offererId } of offerSignals || []) {
      console.log(`offer from ${offererId}`);
      let offeredPeerConnection = createPeerConnection(offererId);

      let remoteDescription = new RTCSessionDescription({
        type: "offer",
        sdp,
      });

      await offeredPeerConnection.setRemoteDescription(remoteDescription);

      offeredPeerConnection.onconnectionstatechange = (event) => {
        console.log(
          `peer connection offered by ${offererId} is in state ${JSON.stringify(event)}`,
        );
      };

      for (let iceCandidate of iceCandidateQueue[offererId] || []) {
        console.log(`dequeuing iceCandidate for offerer ${offererId}`);
        offeredPeerConnection.addIceCandidate(iceCandidate);
      }

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

      peerConnectionPerPeer[offererId] = offeredPeerConnection;
    }

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
      console.log("listening for answers to my offer");

      for (let { peerId: answererId, sdp } of answerSignals) {
        console.log(`answer recevide from ${answererId}`);

        if (answererId in peerConnectionPerPeer) return;

        let answeredPeerConnection = createPeerConnection(answererId);

        let remoteDescription = new RTCSessionDescription({
          type: "answer",
          sdp: sdp,
        });

        await answeredPeerConnection.setRemoteDescription(remoteDescription);

        console.log(`answered peer connection ready with remote description`);

        answeredPeerConnection.onconnectionstatechange = (state) => {
          console.log(
            `peer connection offered by ${answererId} is in state ${state}`,
          );
        };

        console.log(iceCandidateQueue[answererId]);

        for (let iceCandidate of iceCandidateQueue[answererId] || []) {
          answeredPeerConnection.addIceCandidate(iceCandidate);
        }

        peerConnectionPerPeer[answererId] = answeredPeerConnection;
      }
    };

    connectToAnswerer();
  }, [answerSignals]);

  useEffect(() => {
    if (!iceCandidateSignals) return;

    iceCandidateSignals.forEach((signal) => {
      // Find the correct peer connection
      let iceCandidate = new RTCIceCandidate(signal.candidate);
      const targetPeerConnection = peerConnectionPerPeer[signal.peerId];

      if (!targetPeerConnection?.remoteDescription) {
        if (!(signal.peerId in iceCandidateQueue)) {
          console.log(`queueing ice candidate for ${signal.peerId}`);
          iceCandidateQueue[signal.peerId] = [];
        }

        iceCandidateQueue[signal.peerId].push(iceCandidate);
        return;
      }

      console.log(`adding ice candidate to ${signal.peerId} peer connection`);
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
        {Object.keys(remoteStreams).map((peerId) => (
          <div key={peerId}>
            <h3>Remote Stream - {peerId}</h3>
            <video
              autoPlay
              playsInline
              ref={(video) => {
                if (video) video.srcObject = remoteStreams[peerId];
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
