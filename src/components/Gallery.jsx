
import React, { useEffect, useRef, useState } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  increment,
} from "firebase/firestore";
import { db } from "../firebase";
import { useMyContext } from "../Context/MyContext";
import {
  FOLANGE_MEDIA_ROOT,
  folangeCollectionPath,
} from "../config/folangePaths";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";

const CLOUDINARY_CLOUD_NAME =
  process.env.REACT_APP_CLOUDINARY_CLOUD_NAME;

const CLOUDINARY_UPLOAD_PRESET =
  process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET;

const GALLERY_COLLECTION = collection(
  db,
  ...folangeCollectionPath("gallery")
);

const initialForm = {
  title: "",
  caption: "",
  type: "image",
  file: null,
};

// Stable id so signed-out visitors can like once per browser.
const getVisitorId = () => {
  try {
    let id = localStorage.getItem("folange_gallery_visitor");
    if (!id) {
      id = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("folange_gallery_visitor", id);
    }
    return id;
  } catch {
    return "guest_anonymous";
  }
};

export default function Gallery() {
  const { currentUser } = useMyContext() || {};
  const [commentText, setCommentText] = useState("");
  const [commentName, setCommentName] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [form, setForm] = useState(initialForm);

  const fileInputRef = useRef(null);

  // Load gallery items from the existing Folange Firestore collection.
  useEffect(() => {
    const galleryQuery = query(
      GALLERY_COLLECTION,
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      galleryQuery,
      (snapshot) => {
        const data = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }))
          .filter((item) => item.isActive !== false);

        setItems(data);
        setLoading(false);
      },
      (error) => {
        console.error("Folange gallery loading error:", error);
        toast.error("Unable to load gallery.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Upload selected media to Cloudinary using the existing project settings.
  const uploadToCloudinary = async (file, mediaType) => {
    if (!file) {
      throw new Error("Please choose a file first.");
    }

    if (!CLOUDINARY_CLOUD_NAME) {
      throw new Error(
        "REACT_APP_CLOUDINARY_CLOUD_NAME is missing from your environment."
      );
    }

    if (!CLOUDINARY_UPLOAD_PRESET) {
      throw new Error(
        "REACT_APP_CLOUDINARY_UPLOAD_PRESET is missing from your environment."
      );
    }

    const validImageTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];

    const validVideoTypes = [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/ogg",
    ];

    if (
      mediaType === "image" &&
      !validImageTypes.includes(file.type)
    ) {
      throw new Error(
        "Please upload a PNG, JPG, JPEG, or WebP image."
      );
    }

    if (
      mediaType === "video" &&
      !validVideoTypes.includes(file.type)
    ) {
      throw new Error(
        "Please upload an MP4, WebM, MOV, or OGG video."
      );
    }

    const folder = `${FOLANGE_MEDIA_ROOT}/gallery/${mediaType}s`;

    const formData = new FormData();

    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${mediaType}/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    const result = await response.json();

    if (!response.ok || !result.secure_url) {
      throw new Error(
        result?.error?.message ||
          `Cloudinary ${mediaType} upload failed.`
      );
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

  // Handle file selection.
  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] || null;

    setForm((previous) => ({
      ...previous,
      file: selectedFile,
    }));
  };

  // Reset the upload form.
  const resetUploadForm = () => {
    setForm({ ...initialForm });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Open the upload form.
  const openUploadModal = () => {
    resetUploadForm();
    setShowUploadModal(true);
  };

  // Upload media and save its details to Firestore.
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.file) {
      toast.error("Please select an image or video.");
      return;
    }

    setSubmitting(true);

    try {
      const uploaded = await uploadToCloudinary(
        form.file,
        form.type
      );

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

      toast.success(
        `${form.type === "image" ? "Image" : "Video"} uploaded successfully.`
      );

      resetUploadForm();
      setShowUploadModal(false);

      // onSnapshot updates the public gallery automatically.
    } catch (error) {
      console.error("Folange gallery upload failed:", error);

      toast.error(
        error.message || "Unable to upload gallery media."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const actorId = currentUser?.uid || getVisitorId();

  const isLiked = (item) => (item.likedBy || []).includes(actorId);

  const toggleLike = async (item) => {
    const liked = isLiked(item);
    try {
      await updateDoc(doc(db, ...folangeCollectionPath("gallery"), item.id), {
        likedBy: liked ? arrayRemove(actorId) : arrayUnion(actorId),
        likesCount: increment(liked ? -1 : 1),
      });
    } catch (error) {
      console.error("Gallery like failed:", error);
      toast.error("Unable to update like.");
    }
  };

  const shareItem = async (item) => {
    const url = `${window.location.origin}/#gallery`;
    const data = {
      title: item.title || "Folange Beauty Lounge",
      text: item.caption || "See this on Folange Beauty Lounge",
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") toast.error("Unable to share.");
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    const text = commentText.trim();
    if (!text || !selectedMedia) return;

    const author =
      currentUser?.displayName ||
      currentUser?.name ||
      commentName.trim() ||
      "Guest";

    try {
      await updateDoc(
        doc(db, ...folangeCollectionPath("gallery"), selectedMedia.id),
        {
          comments: arrayUnion({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            text: text.slice(0, 500),
            author,
            userId: actorId,
            createdAtMs: Date.now(),
          }),
        }
      );
      setCommentText("");
    } catch (error) {
      console.error("Gallery comment failed:", error);
      toast.error("Unable to post comment.");
    }
  };

  // Keep the open preview in sync with live Firestore updates.
  const liveSelected = selectedMedia
    ? items.find((i) => i.id === selectedMedia.id) || selectedMedia
    : null;

  const ActionBar = ({ item, onComments }) => (
    <div className="flex items-center gap-5 px-4 pb-4 text-sm text-[#786653]">
      <button
        type="button"
        onClick={() => toggleLike(item)}
        className={`flex items-center gap-1 font-semibold transition hover:text-[#A77B38] ${
          isLiked(item) ? "text-red-500" : ""
        }`}
        aria-label="Like"
      >
        {isLiked(item) ? "♥" : "♡"} {Math.max(item.likesCount || 0, 0)}
      </button>
      <button
        type="button"
        onClick={onComments}
        className="flex items-center gap-1 font-semibold transition hover:text-[#A77B38]"
        aria-label="Comments"
      >
        💬 {(item.comments || []).length}
      </button>
      <button
        type="button"
        onClick={() => shareItem(item)}
        className="flex items-center gap-1 font-semibold transition hover:text-[#A77B38]"
        aria-label="Share"
      >
        ↗ Share
      </button>
    </div>
  );

  // Close the upload modal.
  const closeUploadModal = () => {
    if (submitting) return;

    setShowUploadModal(false);
    resetUploadForm();
  };

  return (
    <section
      id="gallery"
      className="scroll-mt-24 bg-[#FFFCF7] px-4 py-16 sm:px-6 lg:px-12"
    >
      <div className="mx-auto max-w-7xl">
        {/* Gallery heading */}
        <div className="relative mx-auto mb-10 max-w-7xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.25em] text-[#A77B38]">
              Folange Beauty Lounge
            </p>

            <h2 className="text-3xl font-bold text-[#493522] sm:text-4xl">
              Our Gallery
            </h2>

            <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-[#C5A15B]" />

            <p className="mt-4 text-sm leading-7 text-[#786653] sm:text-base">
              Explore our beauty collections, products, and moments
              from Folange Beauty Lounge.
            </p>
          </div>

          {/* ADD MEDIA BUTTON */}
          <div className="mt-6 flex justify-center sm:absolute sm:right-0 sm:top-0 sm:mt-0">
            <button
              type="button"
              onClick={openUploadModal}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#A77B38] px-5 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-[#493522] focus:outline-none focus:ring-2 focus:ring-[#C5A15B] focus:ring-offset-2"
            >
              <span className="text-xl leading-none">+</span>
              Add Media
            </button>
          </div>
        </div>

        {/* Gallery loading state */}
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div
                key={item}
                className="h-72 animate-pulse rounded-2xl bg-[#F0E7D9]"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D8C5A5] px-6 py-14 text-center">
            <p className="text-lg font-semibold text-[#493522]">
              Our gallery is growing.
            </p>

            <p className="mt-2 text-sm text-[#786653]">
              Use the Add Media button above to upload your first
              photo or video.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  delay: index * 0.04,
                }}
                className="group overflow-hidden rounded-2xl border border-[#E9DDCA] bg-white text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
              <button
                type="button"
                onClick={() => setSelectedMedia(item)}
                className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-[#C5A15B]"
                aria-label={`View ${item.title || "gallery media"}`}
              >
                <div className="relative h-72 overflow-hidden bg-[#F0E7D9]">
                  {item.type === "video" ? (
                    <video
                      src={item.url}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={item.url}
                      alt={item.title || "Folange Beauty Lounge"}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  )}

                  <div className="absolute inset-0 flex items-center justify-center bg-[#352719]/0 transition duration-300 group-hover:bg-[#352719]/30">
                    <span className="rounded-full border border-white/70 bg-white/90 px-5 py-2 text-sm font-semibold text-[#493522] opacity-0 transition duration-300 group-hover:opacity-100">
                      {item.type === "video"
                        ? "View video"
                        : "View image"}
                    </span>
                  </div>

                  {item.type === "video" && (
                    <span className="absolute left-3 top-3 rounded-full bg-[#493522]/85 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                      Video
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="font-semibold text-[#493522]">
                    {item.title || "Folange Beauty Lounge"}
                  </h3>

                  {item.caption && (
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#786653]">
                      {item.caption}
                    </p>
                  )}
                </div>
              </button>
              {ActionBar({ item, onComments: () => setSelectedMedia(item) })}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ADD MEDIA MODAL */}
      <AnimatePresence>
        {showUploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeUploadModal();
              }
            }}
            className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="my-auto w-full max-w-lg rounded-2xl border border-[#E9DDCA] bg-[#FFFCF7] p-5 shadow-2xl sm:p-7"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gallery-upload-title"
            >
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#A77B38]">
                    Folange Beauty Lounge
                  </p>

                  <h3
                    id="gallery-upload-title"
                    className="mt-1 text-xl font-bold text-[#493522]"
                  >
                    Add Gallery Media
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeUploadModal}
                  disabled={submitting}
                  className="rounded-full px-3 py-2 text-lg text-[#786653] transition hover:bg-[#F0E7D9] disabled:opacity-50"
                  aria-label="Close upload form"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Media type */}
                <div>
                  <label
                    htmlFor="gallery-media-type"
                    className="mb-1 block text-sm font-medium text-[#493522]"
                  >
                    Media Type
                  </label>

                  <select
                    id="gallery-media-type"
                    value={form.type}
                    disabled={submitting}
                    onChange={(event) => {
                      setForm((previous) => ({
                        ...previous,
                        type: event.target.value,
                        file: null,
                      }));

                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }}
                    className="w-full rounded-xl border border-[#D8C5A5] bg-white px-3 py-3 text-sm text-[#493522] outline-none focus:border-[#A77B38] focus:ring-1 focus:ring-[#A77B38]"
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </div>

                {/* Title */}
                <div>
                  <label
                    htmlFor="gallery-media-title"
                    className="mb-1 block text-sm font-medium text-[#493522]"
                  >
                    Title
                  </label>

                  <input
                    id="gallery-media-title"
                    type="text"
                    value={form.title}
                    disabled={submitting}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        title: event.target.value,
                      }))
                    }
                    placeholder="e.g. New Beauty Collection"
                    className="w-full rounded-xl border border-[#D8C5A5] bg-white px-3 py-3 text-sm text-[#493522] outline-none placeholder:text-[#A89A88] focus:border-[#A77B38] focus:ring-1 focus:ring-[#A77B38]"
                  />
                </div>

                {/* Caption */}
                <div>
                  <label
                    htmlFor="gallery-media-caption"
                    className="mb-1 block text-sm font-medium text-[#493522]"
                  >
                    Caption
                  </label>

                  <textarea
                    id="gallery-media-caption"
                    value={form.caption}
                    disabled={submitting}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        caption: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Add a short description..."
                    className="w-full resize-y rounded-xl border border-[#D8C5A5] bg-white px-3 py-3 text-sm text-[#493522] outline-none placeholder:text-[#A89A88] focus:border-[#A77B38] focus:ring-1 focus:ring-[#A77B38]"
                  />
                </div>

                {/* Image/video file */}
                <div>
                  <label
                    htmlFor="gallery-media-file"
                    className="mb-1 block text-sm font-medium text-[#493522]"
                  >
                    {form.type === "image" ? "Image File" : "Video File"}
                  </label>

                  <input
                    id="gallery-media-file"
                    ref={fileInputRef}
                    type="file"
                    accept={
                      form.type === "image"
                        ? "image/png,image/jpeg,image/webp"
                        : "video/mp4,video/webm,video/quicktime,video/ogg"
                    }
                    disabled={submitting}
                    onChange={handleFileChange}
                    className="block w-full rounded-xl border border-[#D8C5A5] bg-white p-3 text-sm text-[#493522] file:mr-3 file:rounded-lg file:border-0 file:bg-[#F0E7D9] file:px-3 file:py-2 file:font-semibold file:text-[#493522]"
                  />

                  {form.file && (
                    <p className="mt-2 break-all text-xs text-[#786653]">
                      Selected: {form.file.name}
                    </p>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 pt-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeUploadModal}
                    disabled={submitting}
                    className="rounded-xl border border-[#D8C5A5] px-5 py-3 text-sm font-semibold text-[#493522] transition hover:bg-[#F0E7D9] disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-xl bg-[#A77B38] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#493522] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting
                      ? "Uploading..."
                      : "Upload to Gallery"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MEDIA PREVIEW MODAL */}
      <AnimatePresence>
        {selectedMedia && (
          <motion.div
            key="gallery-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMedia(null)}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              onClick={(event) => event.stopPropagation()}
              className="relative max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-[#FFFCF7] shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label={selectedMedia.title || "Gallery preview"}
            >
              <button
                type="button"
                onClick={() => setSelectedMedia(null)}
                className="absolute right-3 top-3 z-10 rounded-full bg-[#493522]/85 px-3 py-2 text-white transition hover:bg-[#493522]"
                aria-label="Close gallery preview"
              >
                ✕
              </button>

              {selectedMedia.type === "video" ? (
                <video
                  src={selectedMedia.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[75vh] w-full bg-black object-contain"
                />
              ) : (
                <img
                  src={selectedMedia.url}
                  alt={selectedMedia.title || "Folange gallery"}
                  className="max-h-[75vh] w-full bg-black object-contain"
                />
              )}

              <div className="p-5">
                <h3 className="text-lg font-bold text-[#493522]">
                  {selectedMedia.title || "Folange Beauty Lounge"}
                </h3>

                {selectedMedia.caption && (
                  <p className="mt-2 text-sm leading-6 text-[#786653]">
                    {selectedMedia.caption}
                  </p>
                )}
              </div>

              {liveSelected && (
                <div className="border-t border-[#E9DDCA]">
                  <div className="pt-3">
                    {ActionBar({ item: liveSelected, onComments: () => {} })}
                  </div>

                  <div className="max-h-48 space-y-3 overflow-y-auto px-5 pb-3">
                    {(liveSelected.comments || []).length === 0 ? (
                      <p className="text-sm text-[#A89A88]">
                        No comments yet. Be the first!
                      </p>
                    ) : (
                      [...liveSelected.comments]
                        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
                        .map((c) => (
                          <p key={c.id} className="text-sm text-[#493522]">
                            <span className="font-semibold">{c.author}: </span>
                            {c.text}
                          </p>
                        ))
                    )}
                  </div>

                  <form
                    onSubmit={submitComment}
                    className="flex flex-col gap-2 px-5 pb-5 sm:flex-row"
                  >
                    {!currentUser && (
                      <input
                        value={commentName}
                        onChange={(e) => setCommentName(e.target.value)}
                        placeholder="Your name"
                        className="rounded-xl border border-[#D8C5A5] px-3 py-2 text-sm sm:w-36"
                      />
                    )}
                    <input
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment..."
                      maxLength={500}
                      className="flex-1 rounded-xl border border-[#D8C5A5] px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-[#A77B38] px-4 py-2 text-sm font-semibold text-white hover:bg-[#493522]"
                    >
                      Post
                    </button>
                  </form>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
