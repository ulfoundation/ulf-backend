import mongoose from "mongoose";

const AboutSchema = new mongoose.Schema(
  {
    content: { type: String, required: true },
    images: { type: [String], default: [] }, // ✅ Multiple banner images
  },
  { timestamps: true }
);

export default mongoose.model("About", AboutSchema);
