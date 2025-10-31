import mongoose from "mongoose";

const likeSchema = new mongoose.Schema(
  {
  postId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Post",
  required: true,
  },
  userId: {
  type: String, // ✅ String type to allow "foundation-admin" in dev mode
  required: true,
  },
  },
  { timestamps: true }
);

// ✅ Prevent duplicate likes per user per post
likeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export default mongoose.model("Like", likeSchema);
