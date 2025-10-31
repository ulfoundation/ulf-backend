import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
  postId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Post",
  required: true,
  },
  text: {
  type: String,
  required: true,
  trim: true,
  },
  user: {
  fullname: { type: String, default: "Anonymous" },
  avatar: { type: String, default: "/default-avatar.png" },
  },
  createdAt: {
  type: Date,
  default: Date.now,
  },
  },
  { timestamps: true }
);

// Optional: to support quick comment lookups for a post
commentSchema.index({ postId: 1, createdAt: -1 });

export default mongoose.model("Comment", commentSchema);
