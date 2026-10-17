import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, User } from "lucide-react";
import { itemsApi } from "../../api/items";
import type { Comment } from "../../types";

import { useAuth } from "../../hooks/useAuth";

interface CommentsPanelProps {
  itemId: string;
  canComment: boolean;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({ itemId, canComment }) => {
  const [commentText, setCommentText] = useState("");
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["item-comments", itemId],
    queryFn: () => itemsApi.listComments(itemId),
    refetchInterval: 15000,
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) => {
      const idempotencyKey = crypto.randomUUID();
      return itemsApi.addComment(itemId, body, idempotencyKey);
    },
    onMutate: async (body: string) => {
      await queryClient.cancelQueries({ queryKey: ["item-comments", itemId] });
      const previous = queryClient.getQueryData<{ comments: Comment[]; nextCursor: string | null }>([
        "item-comments",
        itemId,
      ]);

      const optimisticComment: Comment = {
        id: "optimistic-" + crypto.randomUUID(),
        item_id: itemId,
        user_id: user?.id || "temp-user",
        user_name: user?.name || "You",
        body,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<{ comments: Comment[]; nextCursor: string | null }>(
        ["item-comments", itemId],
        (old) => ({
          comments: [optimisticComment, ...(old?.comments || [])],
          nextCursor: old?.nextCursor || null,
        })
      );

      setCommentText("");
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["item-comments", itemId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["item-comments", itemId] });
      queryClient.invalidateQueries({ queryKey: ["item-activity", itemId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || commentMutation.isPending) return;
    commentMutation.mutate(commentText.trim());
  };

  const comments = data?.comments || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        <MessageSquare className="w-4 h-4 text-slate-400" />
        <span>Discussion ({comments.length})</span>
      </div>

      {/* Add Comment Input */}
      {canComment ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add an operational note or update..."
            rows={3}
            className="w-full bg-[#12141c] border border-slate-800 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none transition-all"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!commentText.trim() || commentMutation.isPending}
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              {commentMutation.isPending ? "Posting..." : "Comment"}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-3 bg-slate-900/40 rounded-lg border border-slate-800 text-xs text-slate-400">
          Viewers do not have permission to comment on this item.
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-3 pt-2">
        {isLoading ? (
          <div className="text-xs text-slate-500 py-4 text-center">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-slate-500 py-6 text-center italic">
            No comments yet. Start the conversation above.
          </div>
        ) : (
          comments.map((comment: Comment) => (
            <div
              key={comment.id}
              className="p-3.5 rounded-lg bg-[#12141c]/60 border border-slate-800/80 space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-300">
                  <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
                    <User className="w-3 h-3" />
                  </div>
                  <span>{comment.user_name || "User"}</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  {new Date(comment.created_at).toLocaleString([], {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <p className="text-xs text-slate-300 whitespace-pre-wrap pl-6 leading-relaxed">
                {comment.body}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
