import React, { useState, useEffect, useRef } from "react";
import { useMyContext } from "../Context/MyContext";
import {
  FaUser,
  FaEnvelope,
  FaPhone,
  FaClock,
  FaChevronDown,
  FaChevronUp,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";

const NotesList = () => {
  const { notes } = useMyContext(); // notes already fetched in context
  const prevCountRef = useRef(notes?.length || 0);

  // 🔔 Notify when a new note is added
  useEffect(() => {
    if (!Array.isArray(notes)) return;

    if (notes.length > prevCountRef.current) {
      toast.info("🗒️ New customer note received");
    }

    prevCountRef.current = notes.length;
  }, [notes]);

  if (!Array.isArray(notes) || notes.length === 0) {
    return (
      <div className="p-4 max-w-md mx-auto">
        <h2 className="text-xl font-semibold mb-4 text-center">
          🗒️ Customer Notes
        </h2>
        <p className="text-gray-500 text-center">No notes available yet.</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      <h2 className="text-xl font-semibold mb-4 text-center">
        🗒️ Customer Notes
      </h2>
      <div className="space-y-4">
        {notes
          .slice()
          .sort(
            (a, b) =>
              (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)
          )
          .map((note) => (
            <SingleNote key={note.id} note={note} />
          ))}
      </div>
    </div>
  );
};

const SingleNote = ({ note }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDeleteNote = async (e) => {
    e.stopPropagation();

    const ok = window.confirm("Are you sure you want to delete this note?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "Notes", note.id));
      toast.success("Note deleted");
    } catch (err) {
      console.error("Failed to delete note:", err);
      toast.error("Failed to delete note");
    }
  };

  return (
    <div className="bg-white shadow-md rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="p-4 flex justify-between items-center cursor-pointer"
      >
        <p className="font-medium text-gray-800 truncate">
          {note.note?.length > 50
            ? note.note.substring(0, 50) + "..."
            : note.note}
        </p>
        {isExpanded ? (
          <FaChevronUp className="text-gray-500" />
        ) : (
          <FaChevronDown className="text-gray-500" />
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 text-gray-700 text-sm flex flex-col gap-2">
          {note.userName && (
            <p className="flex items-center gap-2">
              <FaUser className="text-gray-400" /> {note.userName}
            </p>
          )}

          {note.userEmail && (
            <p className="flex items-center gap-2">
              <FaEnvelope className="text-gray-400" /> {note.userEmail}
            </p>
          )}

          {/* ✅ phone number (supports multiple possible field names) */}
          {(note.userPhone || note.phone || note.customerPhone) && (
            <p className="flex items-center gap-2">
              <FaPhone className="text-gray-400" />{" "}
              {note.userPhone || note.phone || note.customerPhone}
            </p>
          )}

          {note.timestamp && (
            <p className="flex items-center gap-2">
              <FaClock className="text-gray-400" />
              {new Date(note.timestamp.seconds * 1000).toLocaleString()}
            </p>
          )}

          <p className="text-gray-800">{note.note}</p>

          {/* ✅ Delete button (now always visible when expanded) */}
          <button
            onClick={handleDeleteNote}
            className="mt-3 inline-flex items-center gap-2 text-red-600 text-sm hover:underline"
          >
            <FaTrash /> Delete Note
          </button>
        </div>
      )}
    </div>
  );
};

export default NotesList;
