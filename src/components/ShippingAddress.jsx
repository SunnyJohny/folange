import React, { useState, useEffect } from "react";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  getAuth,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from "firebase/auth";
import { toast } from "react-toastify";
import CredentialsModal from "./CredentialsModal"; // <- reusable modal
import { useNavigate } from "react-router-dom";
import { useMyContext } from "../Context/MyContext";

// ✅ CHAREX FIRESTORE PATH
// All shipping profile reads and writes are stored under:
// charex/main/users/{uid}
const charexUserRef = (uid) =>
  doc(db, "charex", "main", "users", uid);

// ✅ helpers
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

/**
 * ✅ Normalize Nigerian numbers to MSISDN-like digits.
 * - Keeps already-saved old values exactly as they are WHEN FETCHING (per your request)
 * - On NEW edits/saves, we normalize and store consistent format.
 *
 * Rules:
 * - "0803xxxxxxx" (11 digits starting 0) -> "234803xxxxxxx"
 * - "803xxxxxxx" (10 digits) -> "234803xxxxxxx"
 * - "+234803..." or "234803..." -> "234803..."
 * - anything else -> digits-only fallback
 */
const normalizeNgPhoneTo234 = (input) => {
  const d = onlyDigits(input);

  if (d.length === 11 && d.startsWith("0")) return "234" + d.slice(1);
  if (d.length === 10) return "234" + d;
  if (d.startsWith("234") && d.length >= 13) return d;

  return d;
};

const ShippingAddress = ({ user, onClose, onSuccess }) => {
  const {
    showCredentialsModal,
    newAccount,
    openCredentialsModal,
    closeCredentialsModal,
  } = useMyContext();

  // ✅ ZIP REMOVED COMPLETELY
  const [formData, setFormData] = useState({
    title: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: user?.email || "",
    fullAddress: "",
    // bvn: "", // ✅ BVN (commented out for now)
    // country: "", // removed (optional)
  });

  const [currentUser, setCurrentUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const auth = getAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsubscribe();
  }, [auth]);

  // ✅ If user is logged in, load saved shippingAddress
  // Backward compatible: old users had address/city/state (and maybe zip/country)
  useEffect(() => {
    if (!currentUser?.uid) return;

    (async () => {
      setLoadingProfile(true);
      try {
        const userRef = charexUserRef(currentUser.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const data = snap.data() || {};
          const saved = data.shippingAddress || {};

          // ✅ Prefer new fullAddress, otherwise build from old fields.
          // ✅ ZIP is ignored/removed from display (even if it exists in old records)
          const derivedFullAddress =
            String(saved.fullAddress || "").trim() ||
            [saved.address, saved.city, saved.state, saved.country]
              .filter(Boolean)
              .join(", ")
              .trim();

          if (Object.keys(saved).length > 0) {
            setFormData((prev) => ({
              ...prev,
              // ✅ Only bring in fields we still support:
              title: saved.title ?? prev.title,
              firstName: saved.firstName ?? prev.firstName,
              lastName: saved.lastName ?? prev.lastName,

              /**
               * ✅ IMPORTANT (per your request):
               * When fetching, keep old saved phone EXACTLY as stored.
               * We do NOT normalize here, so old records remain the same in UI.
               */
              phone: saved.phone ?? prev.phone,

              email: saved.email || prev.email || currentUser.email || "",
              fullAddress: derivedFullAddress || prev.fullAddress || "",
            }));
          }

          // ✅ OPTIONAL: one-time migration to store fullAddress for old users
          // (helps future reads; does not store zip)
          if (!saved.fullAddress && derivedFullAddress) {
            try {
              await updateDoc(userRef, {
                "shippingAddress.fullAddress": derivedFullAddress,
              });
            } catch (e) {
              // silent migration failure is ok
            }
          }
        }
      } catch (e) {
        // silent
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [currentUser]);

  const handleChange = (e) => {
    let value = e.target.value;

    // ✅ phone: allow user to type anything, but store a normalized "234..." in state
    // (this affects what gets saved; fetch still shows old values until edited)
    if (e.target.name === "phone") {
      value = normalizeNgPhoneTo234(value);
    }

    setFormData((prev) => ({ ...prev, [e.target.name]: value }));
  };

  const handleClose = async () => {
    if (onClose) onClose();
    navigate("/");
  };

  // ✅ Build a clean payload WITHOUT undefined fields (Firestore disallows undefined)
  // ✅ ZIP removed completely
  // ✅ Supports old users: if they still have city/state in DB, we DO NOT need to keep them;
  // we only keep fullAddress going forward.
  const buildPayload = () => ({
    title: (formData.title || "").trim(),
    firstName: (formData.firstName || "").trim(),
    lastName: (formData.lastName || "").trim(),

    // ✅ normalize on SAVE (even if old record had 080..., it becomes 234... after user edits/saves)
    phone: normalizeNgPhoneTo234(formData.phone),

    email: (formData.email || "").trim(),
    fullAddress: (formData.fullAddress || "").trim(),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      let userId = currentUser?.uid;

      // basic validation
      if (!formData.email || !formData.phone) {
        toast.error("Email and phone number are required.");
        setSaving(false);
        return;
      }

      // ✅ phone validation: must be reasonable digits, prefer 234... (UBA examples)
      const phoneNorm = normalizeNgPhoneTo234(formData.phone);
      if (!phoneNorm || phoneNorm.length < 10) {
        toast.error("Please enter a valid phone number.");
        setSaving(false);
        return;
      }

      // If you want to enforce Nigeria format strictly, uncomment:
      // if (!phoneNorm.startsWith("234") || phoneNorm.length < 13) {
      //   toast.error("Enter a valid Nigerian phone number (e.g. 080..., 070..., +234...).");
      //   setSaving(false);
      //   return;
      // }

      if (!formData.fullAddress?.trim()) {
        toast.error("Full address is required.");
        setSaving(false);
        return;
      }

      const payload = buildPayload();

      if (!currentUser) {
        // Creating a new account from shipping modal
        const password = payload.phone; // your existing logic (now digits-only / normalized)
        const name = `${payload.firstName} ${payload.lastName}`.trim();

        try {
          const userCredential = await createUserWithEmailAndPassword(
            auth,
            payload.email,
            password
          );
          const newUser = userCredential.user;
          userId = newUser.uid;

          const userRef = charexUserRef(userId);

          await setDoc(
            userRef,
            {
              shippingAddress: payload,
              email: payload.email,
              name,
            },
            { merge: true }
          );

          openCredentialsModal(payload.email, password);
          toast.success("Account created and shipping info saved!");
        } catch (authError) {
          console.error("Auth error:", authError);
          if (authError?.code === "auth/email-already-in-use") {
            toast.error("Email already in use. Please sign in instead.");
          } else if (authError?.code === "auth/weak-password") {
            toast.error("Password too weak. Phone number must be at least 6 digits.");
          } else {
            toast.error("Failed to create account.");
          }
        } finally {
          setSaving(false);
        }
      } else {
        // Existing user: just save shipping info
        const userRef = charexUserRef(userId);

        await setDoc(userRef, { shippingAddress: payload }, { merge: true });

        toast.success("Shipping address saved!");
        onSuccess && onSuccess();
        onClose && onClose();
        setSaving(false);
      }
    } catch (error) {
      console.error("Error saving address:", error);
      toast.error("Failed to save address. Please try again.");
      setSaving(false);
    }
  };

  const handleContinueToCheckout = () => {
    closeCredentialsModal();
    navigate("/checkout");
  };

  return (
    <>
      {/* Shipping Address Modal */}
      <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 px-4">
        <div className="bg-white p-6 sm:p-8 rounded-2xl w-full max-w-md sm:max-w-lg md:max-w-2xl shadow-lg relative overflow-y-auto max-h-[90vh]">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-500 hover:text-purple-600 text-2xl font-bold"
            type="button"
          >
            ✕
          </button>

          <h2 className="text-2xl sm:text-3xl font-semibold mb-2 text-center text-gray-800">
            Shipping Address
          </h2>

          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <input
              name="title"
              placeholder="Title"
              value={formData.title}
              onChange={handleChange}
              required
              className="border p-3 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />

            <input
              name="firstName"
              placeholder="First Name"
              value={formData.firstName}
              onChange={handleChange}
              required
              className="border p-3 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />

            <input
              name="lastName"
              placeholder="Last Name"
              value={formData.lastName}
              onChange={handleChange}
              required
              className="border p-3 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />

            <input
              name="phone"
              placeholder="Phone (e.g. 080..., +234...)"
              value={formData.phone}
              onChange={handleChange}
              required
              className="border p-3 rounded-lg outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />

            <input
              name="email"
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleChange}
              required
              className="border p-3 rounded-lg sm:col-span-2 outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />

            {/* ✅ FULL ADDRESS (replaces City + State) */}
            <textarea
              name="fullAddress"
              placeholder="Full Address (Street / City / State / Landmark)"
              value={formData.fullAddress}
              onChange={handleChange}
              required
              rows={3}
              className="border p-3 rounded-lg sm:col-span-2 outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />

            <div className="sm:col-span-2 mt-6">
              <button
                type="submit"
                className="w-full bg-purple-700 hover:bg-purple-800 text-white py-3 rounded-lg font-semibold transition"
                disabled={saving || loadingProfile}
              >
                {saving ? "Saving..." : "Save Shipping Address"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Global reusable credentials modal */}
      <CredentialsModal
        show={showCredentialsModal}
        email={newAccount?.email}
        password={newAccount?.password}
        onClose={closeCredentialsModal}
        onContinue={handleContinueToCheckout}
      />
    </>
  );
};

export default ShippingAddress;