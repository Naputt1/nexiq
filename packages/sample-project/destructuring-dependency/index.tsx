import React, { useCallback } from "react";

// Mock useSelector
const useSelector = (fn: any) => ({
  participants: [],
  reply_count: 0,
  last_reply_at: Date.now(),
  is_following: true,
  post: {
    channel_id: "123",
  },
});

export const ThreadView = () => {
  const thread = useSelector((state: any) => state.thread);
  const {
    is_following: isFollowing = false,
    post: { channel_id: channelId },
  } = thread;

  const handleFollowing = useCallback(
    (e: any) => {
      console.log(isFollowing, channelId);
    },
    [isFollowing, channelId],
  );

  return <div onClick={handleFollowing}>Thread</div>;
};
