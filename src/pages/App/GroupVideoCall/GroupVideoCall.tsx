import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

import { ICE_SERVERS } from "@shared/constants";
import { api } from "../../../../convex/_generated/api";
import { Button } from "../../../components/ui/button";
import { useEnhancedPresence } from "../../../hooks/use-enhanced-presence";
import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { Id } from "../../../../convex/_generated/dataModel";

interface PeerData {
  connection: RTCPeerConnection;
  stream?: MediaStream;
  userInfo?: {
    name?: string;
    image?: string;
    email?: string;
  };
}

const GroupVideoCall = ({ channelId }: { channelId: string }) => {
  const user = useQuery(api.users.viewer);
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [hasJoined, setHasJoined] = useState<boolean>(false);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [videoEnabled, setVideoEnabled] = useState<boolean>(true);

  // Store peer connections and processed signals
  const peersRef = useRef<Record<string, PeerData>>({});
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const iceCandidateQueueRef = useRef<Record<string, RTCIceCandidate[]>>({});

  // Video element refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefsRef = useRef<Record<string, HTMLVideoElement>>({});

  // Use enhanced presence for call participants - always track the room
  const callParticipants = useEnhancedPresence(`video-call-${channelId}`);
  
  // Simplified query parameters - only need ICE candidates now
  const queryParams = useMemo(() => ({
    roomId: `video-call-${channelId}`,
    excludePeer: user?._id || "anonymous",
  }), [channelId, user?._id]);

  const roomQueryParams = useMemo(() => ({
    roomId: `video-call-${channelId}`,
  }), [channelId]);

  // Convex queries - simplified to only what we need
  const offerSignals = useQuery(api.signaling.getOffers, hasJoined ? roomQueryParams : "skip");
  const answerSignals = useQuery(api.signaling.getAnswers, hasJoined ? roomQueryParams : "skip");
  const iceCandidateSignals = useQuery(api.signaling.getIceCandidates, hasJoined ? queryParams : "skip");

  // Convex mutations
  const sendSignal = useMutation(api.signaling.sendRoomSignal);
  const deleteSignal = useMutation(api.signaling.deleteRoomSignal);

  // Get active signaling participants (people who are sending signals)
  const activeSignalers = useMemo(() => {
    const signalers = new Set<string>();
    
    if (offerSignals) {
      offerSignals.forEach(signal => {
        if (signal.peerId && signal.peerId !== user?._id) {
          signalers.add(signal.peerId);
        }
      });
    }
    
    if (answerSignals) {
      answerSignals.forEach(signal => {
        if (signal.peerId && signal.peerId !== user?._id) {
          signalers.add(signal.peerId);
        }
      });
    }
    
    if (iceCandidateSignals) {
      iceCandidateSignals.forEach(signal => {
        if (signal.peerId && signal.peerId !== user?._id) {
          signalers.add(signal.peerId);
        }
      });
    }
    
    return Array.from(signalers);
  }, [offerSignals, answerSignals, iceCandidateSignals, user?._id]);
  
  // Get other participants - combine presence and signaling data
  const otherParticipants = useMemo(() => {
    const participantMap = new Map<string, typeof callParticipants[0]>();
    
    // First, add all presence participants (they're at least in the room)
    callParticipants.forEach(participant => {
      if (participant.userId !== user?._id) {
        participantMap.set(participant.userId, participant);
      }
    });
    
    // Then, mark active signalers as definitely online
    activeSignalers.forEach(signalerId => {
      if (participantMap.has(signalerId)) {
        const participant = participantMap.get(signalerId)!;
        participantMap.set(signalerId, { ...participant, online: true });
      } else {
        // Create a minimal participant entry for active signalers not in presence
        participantMap.set(signalerId, {
          userId: signalerId as Id<"users">,
          online: true,
          name: undefined,
          image: undefined,
          email: undefined,
          lastDisconnected: undefined,
        });
      }
    });
    
    return Array.from(participantMap.values()).filter(p => {
      // Include if they're online OR actively signaling OR recently disconnected
      const now = Date.now();
      const recentlyDisconnected = p.lastDisconnected && (now - p.lastDisconnected) < 30000;
      const isActiveSignaler = activeSignalers.includes(p.userId);
      
      return p.online || isActiveSignaler || recentlyDisconnected;
    });
  }, [callParticipants, activeSignalers, user?._id]);

  // Initialize local media stream
  const initLocalStream = useCallback(async () => {
    try {
      console.log("Starting media initialization...");
      
      const videoConstraints = {
        width: { min: 320, ideal: 640, max: 1280 },
        height: { min: 240, ideal: 480, max: 720 },
        frameRate: { min: 10, ideal: 15, max: 30 }
      };

      const mediaRequests: MediaStreamConstraints = {
        video: videoConstraints,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      };

      console.log("Requesting media with constraints:", mediaRequests);
      
      let stream: MediaStream;
      const attempts = [
        mediaRequests,
        { video: true, audio: true },
        { video: { facingMode: "user" }, audio: true },
        { video: { facingMode: { ideal: "user" } }, audio: true },
        { audio: true }
      ];

      let lastError: any;
      for (let i = 0; i < attempts.length; i++) {
        try {
          console.log(`Attempt ${i + 1}:`, attempts[i]);
          stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
          break;
        } catch (error) {
          console.warn(`Attempt ${i + 1} failed:`, error);
          lastError = error;
          if (i === attempts.length - 1) {
            throw error;
          }
        }
      }
      
      console.log("Got local stream with tracks:", {
        video: stream!.getVideoTracks().length,
        audio: stream!.getAudioTracks().length,
        tracks: stream!.getTracks().map(track => ({ 
          kind: track.kind, 
          enabled: track.enabled, 
          readyState: track.readyState,
          label: track.label 
        }))
      });
      
      setLocalStream(stream!);
    } catch (error) {
      console.error("Failed to get any media:", error);
      alert(`Camera/microphone access failed: ${error instanceof Error ? error.message : String(error)}\nPlease check permissions and try again.`);
    }
  }, []);

  // Create peer connection with enhanced user info
  const createPeerConnection = useCallback((participantId: string, userInfo?: { name?: string; image?: string; email?: string }): RTCPeerConnection => {
    console.log(`Creating peer connection for ${participantId} (${userInfo?.name || 'Unknown'})`);
    
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // Add local stream tracks
    if (localStream) {
      const tracks = localStream.getTracks();
      console.log(`Adding ${tracks.length} tracks to peer connection for ${participantId}:`, 
        tracks.map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState }))
      );
      
      tracks.forEach((track) => {
        const sender = peerConnection.addTrack(track, localStream);
        console.log(`Added ${track.kind} track, sender:`, sender);
      });
    } else {
      console.warn(`No local stream available when creating peer connection for ${participantId}`);
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && user?._id) {
        void sendSignal({
          roomId: `video-call-${channelId}`,
          peerId: user._id,
          userId: user._id,
          candidate: event.candidate.toJSON(),
          type: "ice-candidate",
        });
      }
    };

    // Handle incoming media tracks
    peerConnection.ontrack = (event) => {
      console.log(`Received track from ${participantId} (${userInfo?.name || 'Unknown'})`, {
        track: event.track,
        streams: event.streams,
        trackKind: event.track.kind,
        trackEnabled: event.track.enabled,
        trackReadyState: event.track.readyState
      });
      
      const [remoteStream] = event.streams;
      
      if (remoteStream) {
        const tracks = remoteStream.getTracks();
        console.log(`Remote stream from ${participantId} has ${tracks.length} tracks:`, 
          tracks.map(track => ({ kind: track.kind, enabled: track.enabled, readyState: track.readyState }))
        );
        
        if (tracks.length > 0) {
          console.log(`Setting remote stream for ${participantId}`);
          
          // Update peer data with user info
          if (peersRef.current[participantId]) {
            peersRef.current[participantId].stream = remoteStream;
            peersRef.current[participantId].userInfo = userInfo;
          }
          
          // Update state
          setRemoteStreams(prev => ({ ...prev, [participantId]: remoteStream }));
        } else {
          console.warn(`Remote stream from ${participantId} has no tracks`);
        }
      } else {
        console.warn(`No remote stream received from ${participantId}`);
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(`Peer ${participantId} (${userInfo?.name || 'Unknown'}) connection state: ${peerConnection.connectionState}`);
      
      if (peerConnection.connectionState === 'failed') {
        console.warn(`Connection failed for ${participantId}, will retry...`);
        setTimeout(() => {
          if (peerConnection.connectionState === 'failed') {
            console.error(`Connection permanently failed for ${participantId}, cleaning up`);
            delete peersRef.current[participantId];
            setRemoteStreams(prev => {
              const newStreams = { ...prev };
              delete newStreams[participantId];
              return newStreams;
            });
            delete remoteVideoRefsRef.current[participantId];
          }
        }, 5000);
      } else if (['disconnected', 'closed'].includes(peerConnection.connectionState)) {
        delete peersRef.current[participantId];
        setRemoteStreams(prev => {
          const newStreams = { ...prev };
          delete newStreams[participantId];
          return newStreams;
        });
        delete remoteVideoRefsRef.current[participantId];
      } else if (peerConnection.connectionState === 'connected') {
        console.log(`✅ Successfully connected to ${participantId} (${userInfo?.name || 'Unknown'})`);
      }
    };

    return peerConnection;
  }, [localStream, channelId, user?._id, sendSignal]);

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

  // Handle new participants joining via presence
  useEffect(() => {
    if (!hasJoined || !user?._id || !localStream) return;

    // Create connections for new participants
    otherParticipants.forEach(participant => {
      if (!peersRef.current[participant.userId]) {
        console.log(`New participant detected: ${participant.name} (${participant.userId})`);
        
        const userInfo = {
          name: participant.name,
          image: participant.image,
          email: participant.email,
        };
        
        const peerConnection = createPeerConnection(participant.userId, userInfo);
        peersRef.current[participant.userId] = { 
          connection: peerConnection,
          userInfo 
        };
        
                 // Create and send offer to new participant
         void (async () => {
           try {
             const offer = await peerConnection.createOffer();
             await peerConnection.setLocalDescription(offer);

             if (offer.sdp) {
               await sendSignal({
                 roomId: `video-call-${channelId}`,
                 peerId: user._id,
                 userId: user._id,
                 sdp: offer.sdp,
                 type: "offer",
               });
             }
           } catch (error) {
             console.error(`Error creating offer for ${participant.userId}:`, error);
           }
         })();
      }
    });

    // Clean up connections for participants who left
    Object.keys(peersRef.current).forEach(participantId => {
      const stillPresent = otherParticipants.some(p => p.userId === participantId);
      if (!stillPresent) {
        console.log(`Participant left: ${participantId}`);
        
        const peerData = peersRef.current[participantId];
        if (peerData) {
          peerData.connection.close();
          delete peersRef.current[participantId];
          
          setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[participantId];
            return newStreams;
          });
          
          delete remoteVideoRefsRef.current[participantId];
        }
      }
    });
  }, [hasJoined, user?._id, localStream, otherParticipants, createPeerConnection, sendSignal, channelId]);

  // Handle incoming offers (when someone else creates an offer, we need to answer)
  useEffect(() => {
    if (!hasJoined || !offerSignals || !user?._id) return;

    offerSignals.forEach(({ sdp, peerId: offererId }) => {
      const signalId = `offer-${offererId}-${sdp?.substring(0, 50) || ''}`;
      
      if (processedSignalsRef.current.has(signalId) || offererId === user._id) return;
      processedSignalsRef.current.add(signalId);

      console.log(`Processing offer from ${offererId}`);

      void (async () => {
        try {
          // Find participant info
          const participant = otherParticipants.find(p => p.userId === offererId);
          const userInfo = participant ? {
            name: participant.name,
            image: participant.image,
            email: participant.email,
          } : undefined;

          // Create peer connection if it doesn't exist
          if (!peersRef.current[offererId]) {
            const peerConnection = createPeerConnection(offererId, userInfo);
            peersRef.current[offererId] = { connection: peerConnection, userInfo };
            
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
              roomId: `video-call-${channelId}`,
              sdp: answer.sdp,
              peerId: user._id,
              userId: user._id,
              candidate: offererId,
            });
          }

          console.log(`Sent answer to ${offererId}`);
        } catch (error) {
          console.error(`Error processing offer from ${offererId}:`, error);
        }
      })();
    });
  }, [hasJoined, offerSignals, user?._id, channelId, otherParticipants, createPeerConnection, processQueuedIceCandidates, sendSignal]);

  // Handle incoming answers (when someone answers our offer)
  useEffect(() => {
    if (!hasJoined || !answerSignals) return;

    answerSignals.forEach(({ peerId: answererId, sdp, candidate }) => {
      const signalId = `answer-${answererId}-${sdp?.substring(0, 50) || ''}`;
      
      if (processedSignalsRef.current.has(signalId) || candidate !== user?._id) return;
      processedSignalsRef.current.add(signalId);

      console.log(`Processing answer from ${answererId}`);

      void (async () => {
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
      })();
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
          console.log(`Queueing ICE candidate for ${candidatePeerId}`);
          if (!iceCandidateQueueRef.current[candidatePeerId]) {
            iceCandidateQueueRef.current[candidatePeerId] = [];
          }
          iceCandidateQueueRef.current[candidatePeerId].push(iceCandidate);
          return;
        }

        console.log(`Adding ICE candidate for ${candidatePeerId}`);
        void peerConnection.addIceCandidate(iceCandidate);
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
      // The presence system will handle the rest automatically
      console.log("Successfully joined call");
    } catch (error) {
      console.error("Error joining call:", error);
      setHasJoined(false);
    }
  }, [user?._id, localStream]);

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
      void deleteSignal({ roomId: `video-call-${channelId}`, peerId: user?._id || "anonymous" });
      
      console.log("Successfully left call");
    } catch (error) {
      console.error("Error leaving call:", error);
    }
  }, [channelId, user?._id, deleteSignal]);

  // Initialize on mount
  useEffect(() => {
    void initLocalStream();
    return () => {
      void leaveCall();
    };
  }, [initLocalStream, leaveCall]);

  // Update local video when stream changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      
      const playPromise = localVideoRef.current.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log("✅ Local video playback started");
          })
          .catch(error => {
            console.log("⚠️ Local video auto-play prevented:", error);
          });
      }
    }
  }, [localStream]);

  // Re-add tracks to existing peer connections when local stream changes
  useEffect(() => {
    if (!localStream) return;

    console.log("Local stream updated, checking existing peer connections...");
    
    Object.entries(peersRef.current).forEach(([remotePeerId, peerData]) => {
      const senders = peerData.connection.getSenders();
      console.log(`Peer ${remotePeerId} has ${senders.length} senders`);
      
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

  // Toggle video track
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const newEnabled = !videoEnabled;
        videoTracks.forEach(track => {
          track.enabled = newEnabled;
        });
        setVideoEnabled(newEnabled);
        console.log(`Video ${newEnabled ? 'enabled' : 'disabled'}`);
      }
    }
  }, [localStream, videoEnabled]);

  return (
    <div style={{ padding: '16px' }}>
      <h1 style={{ marginBottom: '20px' }}>Group Video Call</h1>
      
      <div className="video-container" style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3>You ({user?.name || 'Unknown'})</h3>
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
        
        {Object.entries(remoteStreams).map(([participantId, stream]) => {
          const peerData = peersRef.current[participantId];
          const userInfo = peerData?.userInfo;
          
          return (
            <div key={participantId} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <Avatar className="h-6 w-6 mr-2">
                  <AvatarImage src={userInfo?.image} />
                  <AvatarFallback>
                    {userInfo?.name?.charAt(0).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <h3>{userInfo?.name || 'Unknown User'}</h3>
              </div>
              <video
                ref={(video) => {
                  if (video && !remoteVideoRefsRef.current[participantId]) {
                    remoteVideoRefsRef.current[participantId] = video;
                    
                    video.srcObject = stream;
                    
                    const playPromise = video.play();
                    
                    if (playPromise !== undefined) {
                      void playPromise
                        .then(() => {
                          console.log(`✅ Video playback started for ${participantId}`);
                        })
                        .catch(error => {
                          console.log(`⚠️ Auto-play prevented for ${participantId}:`, error);
                        });
                    }
                  }
                }}
                autoPlay
                playsInline
                muted={false}
                style={{ 
                  width: '100%', 
                  maxWidth: '300px', 
                  height: 'auto',
                  aspectRatio: '4/3',
                  border: '1px solid #ccc',
                  borderRadius: '8px',
                  backgroundColor: '#f0f0f0'
                }}
              />
            </div>
          );
        })}
      </div>
      
      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        marginBottom: '16px',
        flexWrap: 'wrap'
      }}>
        <Button onClick={() => void initLocalStream()} disabled={!!localStream}>
          Request Camera/Mic
        </Button>
        <Button onClick={toggleVideo} disabled={!localStream || localStream.getVideoTracks().length === 0}>
          {videoEnabled ? '📹 Video On' : '📹 Video Off'}
        </Button>
        <Button onClick={() => void joinCall()} disabled={hasJoined || !localStream}>
          Join Call
        </Button>
        <Button onClick={() => void leaveCall()} disabled={!hasJoined}>
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
        <div><strong>Connected peers:</strong> {Object.keys(remoteStreams).length}</div>
        <div><strong>Status:</strong> {hasJoined ? '🟢 Joined' : '🔴 Not joined'}</div>
        <div><strong>Local stream:</strong> {localStream ? '✅ Ready' : '❌ Not ready'}</div>
        <div><strong>Call participants:</strong> {callParticipants.length} total ({otherParticipants.length} others)</div>
        {localStream && (
          <div><strong>Local tracks:</strong> 
            🎥 {localStream.getVideoTracks().length} video, 
            🎤 {localStream.getAudioTracks().length} audio
          </div>
        )}
        <div><strong>Participants:</strong></div>
        {callParticipants.map(participant => (
          <div key={participant.userId} style={{ marginLeft: '16px' }}>
            • {participant.name || 'Unknown'} {participant.online ? '🟢' : '🔴'}
            {participant.userId === user?._id && ' (You)'}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GroupVideoCall;
