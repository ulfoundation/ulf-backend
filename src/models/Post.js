import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
  title: {
  type: String,
  trim: true,
  },
  content: {
  type: String,
  required: true,
  trim: true,
  },

  // ✅ Correctly store Cloudinary objects { thumb, full }
  imageUrls: [
  {
  thumb: { type: String, trim: true },
  full: { type: String, trim: true },
  },
  ],

  memberId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: false,
  },

  member: {
  fullname: {
  type: String,
  default: "Foundation",
  },
  avatar: {
  type: String,
  default: "",
  },
  },

  likes: [
  {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  },
  ],
  comments: [
  {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Comment",
  },
  ],

  createdAt: {
  type: Date,
  default: Date.now,
  },
  },
  { timestamps: true }
);

export default mongoose.model("Post", postSchema);
