import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Team member name is required"],
      trim: true,
    },
    title: {
      type: String,
      required: [true, "Team member title is required"],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    photo: {
      type: String,
      trim: true,
      default: "",
    },
    bio: {
      type: String,
      trim: true,
      default: "",
    },
    facebook: {
      type: String,
      trim: true,
      default: "",
    },
    instagram: {
      type: String,
      trim: true,
      default: "",
    },
    linkedin: {
      type: String,
      trim: true,
      default: "",
    },
    twitter: {
      type: String,
      trim: true,
      default: "",
    },

    // 🧩 NEW FIELD: for drag-and-drop order persistence
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Optional: ensure consistent sorting when querying
teamSchema.index({ order: 1 });

export default mongoose.model("Team", teamSchema);
