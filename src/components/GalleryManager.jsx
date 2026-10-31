import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  FOLANGE_MEDIA_ROOT,
  folangeCollectionPath,
} from "../config/folangePaths";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";

const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET;

const GALLERY_COLLECTION = collection(db, ...folangeCollectionPath("gallery"));

const initialForm = {
  title: "",
  caption: "",
  type: "image",
  file: null,
};

export default function GalleryManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    const q = query(GALLERY_COLLECTION, orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setItems(data);
        setLoading(false);
      },
      (error) => {
        console.error("Gallery fetch error:", error);
        toast.error("Unable to load gallery");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const uploadToCloudinary = async (file, mediaType) => {
    if (!file) throw new Error("Please choose a file first.");

    if (!CLOUDINARY_CLOUD_NAME) {
      throw new Error("REACT_APP_CLOUDINARY_CLOUD_NAME is missing.");
    }
    if (!CLOUDINARY_UPLOAD_PRESET) {
      throw new Error("REACT_APP_CLOUDINARY_UPLOAD_PRESET is missing.");
    }

    const validImageTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    const validVideoTypes = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

    if (mediaType === "image" && !validImageTypes.includes(file.type)) {
      throw new Error("Please upload a valid image file.");
    }

    if (mediaType === "video" && !validVideoTypes.includes(file.type)) {
      throw new Error("Please upload a valid video file.");
    }

    const folder = `${FOLANGE_MEDIA_ROOT}/gallery/${mediaType}s`;

    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    fd.append("folder", folder);
    fd.append("resource_type", mediaType);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${mediaType}/upload`,
      {
        method: "POST",
        body: fd,
      }
    );

    const result = await response.json();

    if (!response.ok || !result.secure_url) {
      throw new Error(result?.error?.message || `Cloudinary ${mediaType} upload failed.`);
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      width: result.width || null,
      height: result.height || null,
      resourceType: result.resource_type || mediaType,
    };
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setForm((prev) => ({ ...prev, file: selected }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.file) {
      toast.error("Please select an image or video.");
      return;
    }

    setSubmitting(true);

    try {
      const uploaded = await uploadToCloudinary(form.file, form.type);

      await addDoc(GALLERY_COLLECTION, {
        title: form.title.trim() || "Untitled media",
        caption: form.caption.trim(),
        type: form.type,
        fileName: form.file.name,
        url: uploaded.url,
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        createdAt: serverTimestamp(),
        isActive: true,
      });

      toast.success(`${form.type === "image" ? "Image" : "Video"} uploaded successfully.`);
      setForm(initialForm);
      setShowUploadModal(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Upload failed:", error);
      toast.error(error.message || "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this gallery item?")) return;

    try {
      await deleteDoc(doc(db, ...folangeCollectionPath("gallery"), id));
      toast.success("Gallery item removed.");
    } catch (error) {
      console.error("Delete failed:", error);
      toast.error("Unable to delete gallery item.");
    }
  };

  const mediaItems = useMemo(() => items || [], [items]);

  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Gallery</h2>
          <p className="text-sm text-gray-500">
            Firestore: {folangeCollectionPath("gallery").join("/")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowUploadModal(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90"
        >
          + Add Media
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-56 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : mediaItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-gray-500">
          No media in the gallery yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mediaItems.map((item) => (
            <motion.div
              key={item.id}
              layout
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            >
              <div className="relative">
                {item.type === "video" ? (
                  <video
                    src={item.url}
                    controls
                    className="h-60 w-full object-cover"
                    playsInline
                  />
                ) : (
                  <img
                    src={item.url}
                    alt={item.title || "Gallery media"}
                    className="h-60 w-full object-cover"
                  />
                )}
              </div>

              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium uppercase text-gray-700">
                    {item.type}
                  </span>

                  <button
                    type="button"
                    onClick={() => setSelectedMedia(item)}
                    className="text-xs font-medium text-primary underline"
                  >
                    Preview
                  </button>
                </div>

                <h3 className="font-semibold text-gray-900">{item.title}</h3>

                {item.caption && (
                  <p className="line-clamp-2 text-sm text-gray-500">{item.caption}</p>
                )}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMedia(item)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    View
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showUploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-bold">Upload media</h3>
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="text-gray-500"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Title</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    placeholder="Summer collection"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Caption</label>
                  <textarea
                    value={form.caption}
                    onChange={(e) => setForm((prev) => ({ ...prev, caption: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    rows={3}
                    placeholder="Add a short description"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {form.type === "image" ? "Image" : "Video"} file
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={form.type === "image" ? "image/*" : "video/*"}
                    onChange={handleFileChange}
                    className="block w-full text-sm text-gray-600"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-primary px-4 py-2 font-medium text-white disabled:opacity-60"
                  >
                    {submitting ? "Uploading..." : "Upload"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedMedia && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          >
            <motion.div
              initial={{ scale: 0.96, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 20 }}
              className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-white"
            >
              <button
                type="button"
                onClick={() => setSelectedMedia(null)}
                className="absolute right-4 top-4 z-10 rounded-full bg-black/50 px-3 py-1 text-sm text-white"
              >
                ✕
              </button>

              {selectedMedia.type === "video" ? (
                <video src={selectedMedia.url} controls className="max-h-[80vh] w-full object-contain" />
              ) : (
                <img
                  src={selectedMedia.url}
                  alt={selectedMedia.title || "Gallery media"}
                  className="max-h-[80vh] w-full object-contain"
                />
              )}

              <div className="border-t bg-white p-4">
                <h3 className="text-lg font-bold">{selectedMedia.title}</h3>
                {selectedMedia.caption && <p className="mt-1 text-sm text-gray-600">{selectedMedia.caption}</p>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}