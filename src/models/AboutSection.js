import mongoose from "mongoose";

const AboutSectionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      default: "",
    },
    updatedBy: {
      type: String,
      default: "System",
    },
  },
  { timestamps: true }
);

export default mongoose.model("AboutSection", AboutSectionSchema);
