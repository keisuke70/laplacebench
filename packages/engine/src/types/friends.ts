/**
 * Friends and social features related types
 * Shared between Web, Server, and Mobile projects
 */

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Friend {
  friend_id: string;
  username: string;
  avatar_url: string | null;
  friendship_created_at: string;
}

export interface FriendRequest {
  request_id: string;
  requester_id: string;
  requester_username: string;
  requester_avatar_url: string | null;
  created_at: string;
}

export interface SentFriendRequest {
  request_id: string;
  requested_id: string;
  requested_username: string;
  requested_avatar_url: string | null;
  created_at: string;
}

export interface FriendshipStatus {
  isFriend: boolean;
  hasPendingRequest: boolean;
  canSendRequest: boolean;
}

export type FriendshipStatusString =
  | "friends"
  | "pending_sent"
  | "pending_received"
  | "none";

export interface FriendsData {
  friends: Friend[];
  pendingRequests: FriendRequest[];
  sentRequests: SentFriendRequest[];
}