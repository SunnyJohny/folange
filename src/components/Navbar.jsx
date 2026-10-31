
import { useEffect, useState, useRef } from "react";
import { AiFillEyeInvisible, AiFillEye } from "react-icons/ai";
import { FaGoogle, FaFacebook } from "react-icons/fa";
import { FaBarsStaggered, FaXmark, FaEnvelope, FaBagShopping } from "react-icons/fa6";
import { FaUserCircle } from "react-icons/fa";
import Dashboard from "./Dashboard";

import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

import { doc, updateDoc, deleteDoc } from "firebase/firestore";

import { db } from "../firebase";
import { toast, ToastContainer } from "react-toastify";

import "react-toastify/dist/ReactToastify.css";
import { useMyContext } from "../Context/MyContext";
import { folangeUserPath, folangeProductPath, folangeDocumentPath } from "../config/folangePaths";
import Cart from "./Cart";
import SearchBar from "./SearchBar";

const FOLANGE_LOGO = "/images/Folange%20Beauty%20Lounge%20logo.png";

const SECTION_ALIASES = {
  home: ["home", "hero"],
  about: ["about", "about-us", "aboutUs"],
  services: ["services", "our-services"],
  store: ["store", "products", "shop", "cookingitems", "cooking-items", "cookingItems"],
  academy: ["academy", "training", "courses"],
  gallery: ["gallery", "galary", "galery"],
  faq: ["faq", "faqs"],
  contact: ["contact", "contact-us"],
};

const Navbar = () => {
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  const [currentUser, setCurrentUser] = useState(null);

  // Search dropdown and detailed modal item
  const [selectedItem, setSelectedItem] = useState(null);

  const [loadingItemId, setLoadingItemId] = useState(null);

  // Detailed modal variants and quantity
  const [activeColor, setActiveColor] = useState(null);

  const [activeSize, setActiveSize] = useState(null);

  const [selectedQty, setSelectedQty] = useState(1);

  const [lastVariantSelection, setLastVariantSelection] = useState(null);

  const [savedScroll, setSavedScroll] = useState(0);

  const [signUpName, setSignUpName] = useState("");

  const [signUpEmail, setSignUpEmail] = useState("");

  const [signUpPassword, setSignUpPassword] = useState("");

  const [signUpLoading, setSignUpLoading] = useState(false);

  const [showDashboard, setShowDashboard] = useState(false);

  // Inbox modal and selected note
  const [showInbox, setShowInbox] = useState(false);

  const {
    cart,
    toggleCart,
    isCartOpen,
    capitalizeWords,
    searchQuery,
    setSearchQuery,
    filteredCookingItems,
    addToCart,
    showSignInModal,
    setShowSignInModal,
    showSignUpModal,
    setShowSignUpModal,
    notes,
    isAdmin,
  } = useMyContext();

  const auth = getAuth();

  // Helpers
  const normalize = (value) =>
    (value || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const getName = (maybeObjOrString) =>
    typeof maybeObjOrString === "string" ? maybeObjOrString : (maybeObjOrString?.name ?? null);

  const hasVariants = (item) =>
    (Array.isArray(item?.colors) && item.colors.length > 0) ||
    (Array.isArray(item?.sizes) && item.sizes.length > 0);

  const toNum = (value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  };

  const getVariantPrice = (item, colorName, sizeName, lastSelection = null) => {
    if (!item) return 0;

    const basePrice = toNum(item.priceDiscounted) ?? toNum(item.priceOriginal) ?? 0;

    if (!hasVariants(item)) {
      return basePrice;
    }

    const sizeObj = sizeName && (item.sizes || []).find((size) => getName(size) === sizeName);

    const colorObj = colorName && (item.colors || []).find((color) => getName(color) === colorName);

    const sizePrice = sizeObj && (toNum(sizeObj.priceDiscounted) ?? toNum(sizeObj.priceOriginal));

    const colorPrice =
      colorObj && (toNum(colorObj.priceDiscounted) ?? toNum(colorObj.priceOriginal));

    if (lastSelection === "size") {
      return sizePrice ?? colorPrice ?? basePrice;
    }

    if (lastSelection === "color") {
      return colorPrice ?? sizePrice ?? basePrice;
    }

    return sizePrice ?? colorPrice ?? basePrice;
  };

  const getImageForVariant = (item, colorName, sizeName, lastSelection = null) => {
    if (!item) {
      return "/placeholder.jpg";
    }

    const color = colorName ? String(colorName).trim() : null;

    const size = sizeName ? String(sizeName).trim() : null;

    const sizeUrl = size ? item?.sizeImages?.[size] : null;

    const colorUrl = color ? item?.colorImages?.[color] : null;

    if (lastSelection === "size") {
      return sizeUrl || colorUrl || item.image || "/placeholder.jpg";
    }

    if (lastSelection === "color") {
      return colorUrl || sizeUrl || item.image || "/placeholder.jpg";
    }

    return sizeUrl || colorUrl || item.image || "/placeholder.jpg";
  };

  const clampQtyToStock = (quantity, stock) => {
    const parsedQuantity = Number(quantity || 1);

    const parsedStock = Number(stock || 0);

    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return 1;
    }

    if (!Number.isFinite(parsedStock) || parsedStock <= 0) {
      return 1;
    }

    return Math.min(parsedQuantity, parsedStock);
  };

  // Approximate stock information used in Navbar
  const getApproxStock = (item) => {
    if (!item) return 0;

    const colorObject =
      activeColor && (item.colors || []).find((color) => getName(color) === activeColor);

    const sizeObject =
      activeSize && (item.sizes || []).find((size) => getName(size) === activeSize);

    const quantityFromVariant =
      Number(colorObject?.quantity || 0) || Number(sizeObject?.quantity || 0) || null;

    if (quantityFromVariant !== null && quantityFromVariant !== 0) {
      return quantityFromVariant;
    }

    return Number(item.quantity || 0);
  };

  // Authentication observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });

    return () => unsubscribe();
  }, [auth]);

  const toggleMenu = () => {
    setIsMenuOpen((current) => !current);
  };

  const handleToggleCart = () => {
    toggleCart();

    if (isMenuOpen) {
      setIsMenuOpen(false);
    }
  };

  // Expandable note component
  const NoteItem = ({ note, formatTimestamp }) => {
    const [expanded, setExpanded] = useState(false);

    const { isAdmin: noteIsAdmin, notes: contextNotes, setNotes } = useMyContext();

    const handleDeleteNote = async (event) => {
      event.stopPropagation();

      if (!window.confirm("Are you sure you want to delete this note?")) {
        return;
      }

      try {
        await deleteDoc(doc(db, ...folangeDocumentPath("Notes", note.id)));

        if (setNotes) {
          setNotes(contextNotes.filter((currentNote) => currentNote.id !== note.id));
        }

        toast.success("Note deleted successfully!");
      } catch (error) {
        console.error("Error deleting note:", error);

        toast.error("Failed to delete note");
      }
    };

    return (
      <div
        className="border rounded-md cursor-pointer hover:bg-gray-50 transition-all duration-300 overflow-hidden"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center">
          <div className="flex flex-col">
            <p className="font-semibold">{note.userName || "Unknown Name"}</p>

            <p className="text-sm text-gray-600">{note.userEmail || "No Email"}</p>

            <p className="text-sm text-gray-600">{note.customerPhone || "No Phone"}</p>

            <p className="text-sm text-gray-600">{formatTimestamp(note.timestamp)}</p>
          </div>
        </div>

        <div
          className={`px-4 text-gray-700 text-sm transition-all duration-300 ${
            expanded ? "max-h-96 opacity-100 pb-4" : "max-h-0 opacity-0"
          } overflow-hidden`}
        >
          {note.note}

          {noteIsAdmin && (
            <div
              className={`mt-4 flex justify-end transition-all duration-300 transform ${
                expanded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              <button
                type="button"
                onClick={handleDeleteNote}
                className="text-red-500 text-sm px-4 py-1.5 border border-red-500 rounded hover:bg-red-500 hover:text-white transition"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Measure this navbar so content and anchor links clear the fixed header.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;

    const updateHeight = () => setHeaderHeight(Math.ceil(header.getBoundingClientRect().height));
    updateHeight();
    window.addEventListener("resize", updateHeight);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateHeight) : null;
    observer?.observe(header);

    return () => {
      window.removeEventListener("resize", updateHeight);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [setSearchQuery]);

  const handleScrollAdjust = (event, path) => {
    event.preventDefault();
    setIsMenuOpen(false);
    setSearchQuery("");

    if (path === "profile") {
      if (currentUser) {
        setShowDashboard(true);
      } else {
        setShowSignUpModal(false);
        setShowSignInModal(true);
      }
      return;
    }

    window.requestAnimationFrame(() => {
      const target = (SECTION_ALIASES[path] || [path])
        .map((id) => document.getElementById(id))
        .find(Boolean);

      if (!target && path !== "home") {
        console.warn(`Navigation target with id "${path}" was not found.`);
        return;
      }

      const offset = headerRef.current?.getBoundingClientRect().height || 0;
      const top = target ? target.getBoundingClientRect().top + window.scrollY - offset - 12 : 0;
      window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
      window.history.replaceState(null, "", `#${target?.id || path}`);
    });
  };

  const handleSignUp = async (event) => {
    event.preventDefault();

    const receivedName = signUpName.replace(/\s+/g, " ").trim();

    const receivedEmail = signUpEmail.trim().toLowerCase();

    if (!receivedName) {
      toast.warn("Please enter your full name.");

      return;
    }

    if (receivedName.length < 2) {
      toast.warn("Please enter a valid full name.");

      return;
    }

    if (!receivedEmail) {
      toast.warn("Please enter your email address.");

      return;
    }

    if (!signUpPassword) {
      toast.warn("Please enter a password.");

      return;
    }

    if (signUpPassword.length < 6) {
      toast.warn("Password must contain at least 6 characters.");

      return;
    }

    try {
      setSignUpLoading(true);

      const { createUserWithEmailAndPassword, updateProfile } = await import("firebase/auth");

      const { doc: firestoreDoc, setDoc, serverTimestamp } = await import("firebase/firestore");

      const { db: firestoreDb } = await import("../firebase");

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        receivedEmail,
        signUpPassword,
      );

      const user = userCredential.user;

      await updateProfile(user, {
        displayName: receivedName,
      });

      const userDocumentReference = firestoreDoc(firestoreDb, ...folangeUserPath(user.uid));

      await setDoc(
        userDocumentReference,
        {
          uid: user.uid,
          name: receivedName,
          displayName: receivedName,
          email: receivedEmail,
          role: "customer",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        {
          merge: true,
        },
      );

      setCurrentUser({
        ...user,
        displayName: receivedName,
      });

      toast.success(`Welcome ${receivedName}! Your account was created successfully.`);

      setSignUpName("");
      setSignUpEmail("");
      setSignUpPassword("");
      setShowSignUpPassword(false);
      setShowSignUpModal(false);
    } catch (error) {
      console.error("Sign-up error:", error);

      const errorCode = error?.code;

      if (errorCode === "auth/email-already-in-use") {
        toast.error("An account already exists with this email address. Please sign in instead.");
      } else if (errorCode === "auth/invalid-email") {
        toast.error("Please enter a valid email address.");
      } else if (errorCode === "auth/weak-password") {
        toast.error("Password must contain at least 6 characters.");
      } else if (errorCode === "auth/network-request-failed") {
        toast.error("Network error. Please check your internet connection and try again.");
      } else if (errorCode === "permission-denied") {
        toast.error(
          "Your account was created, but we could not finish setting up your profile. Please contact us for help.",
        );
      } else {
        toast.error(error?.message || "Account creation failed. Please try again.");
      }
    } finally {
      setSignUpLoading(false);
    }
  };

  const handleSignIn = async (event) => {
    event.preventDefault();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      if (userCredential.user) {
        toast.success("Signed in successfully!");

        setShowSignInModal(false);
      }
    } catch {
      toast.error("Bad user credentials");
    }
  };

  // Fixed password-reset handler
  const handleForgotPassword = async (event) => {
    if (event?.preventDefault) {
      event.preventDefault();
    }

    const resetEmail = email.trim();

    if (!resetEmail) {
      toast.warn("Please enter your email address first.");

      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(resetEmail)) {
      toast.warn("Please enter a valid email address.");

      return;
    }

    try {
      setResetPasswordLoading(true);

      /*
        No ActionCodeSettings or continue URL is passed here.
        Firebase will use its standard password-reset page.
        This prevents auth/unauthorized-continue-uri.
      */
      await sendPasswordResetEmail(auth, resetEmail);

      toast.success(
        `Password reset link sent to ${resetEmail}. Please check your inbox or spam folder.`,
      );
    } catch (error) {
      console.error("Password reset error:", error);

      const errorCode = error?.code;

      if (errorCode === "auth/invalid-email") {
        toast.error("Please enter a valid email address.");
      } else if (errorCode === "auth/too-many-requests") {
        toast.error("Too many attempts. Please wait and try again later.");
      } else if (errorCode === "auth/network-request-failed") {
        toast.error("Network error. Please check your internet connection.");
      } else if (errorCode === "auth/unauthorized-continue-uri") {
        toast.error("This website domain has not been authorized in Firebase.");
      } else {
        toast.error(error?.message || "Failed to send password reset link. Please try again.");
      }
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    toast.info("Google sign-in is not available now. Please try again later.");
  };

  const handleFacebookSignIn = async () => {
    try {
      const { FacebookAuthProvider, signInWithPopup } = await import("firebase/auth");

      const provider = new FacebookAuthProvider();

      const result = await signInWithPopup(auth, provider);

      toast.success(`Welcome, ${result.user.displayName || "Guest"}!`);

      setShowSignInModal(false);
    } catch (error) {
      console.error("Facebook Sign-in error:", error);

      toast.error("Facebook sign-in failed");
    }
  };

  const handleLogout = () => {
    if (isMenuOpen) {
      setIsMenuOpen(false);
    }

    signOut(auth)
      .then(() => toast.info("Logged out"))
      .catch(() => toast.error("Logout failed"));
  };

  // Detailed Add to Cart from modal
  const handleAddToCartDetailed = async (item) => {
    if (!item) return;

    setLoadingItemId(item.id);

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));

      const itemHasVariants = hasVariants(item);

      const chosenColor =
        itemHasVariants && Array.isArray(item.colors) && item.colors.length > 0
          ? activeColor || getName(item.colors[0])
          : null;

      const chosenSize =
        itemHasVariants && Array.isArray(item.sizes) && item.sizes.length > 0
          ? activeSize || getName(item.sizes[0])
          : null;

      const approximateStock = getApproxStock(item);

      if (approximateStock > 0) {
        const clamped = clampQtyToStock(selectedQty, approximateStock);

        if (clamped !== selectedQty) {
          setSelectedQty(clamped);

          toast.info(`Only ${approximateStock} left for this selection.`);

          return;
        }
      }

      const resolvedPrice = itemHasVariants
        ? getVariantPrice(item, chosenColor, chosenSize, lastVariantSelection)
        : (toNum(item.priceDiscounted) ?? toNum(item.priceOriginal) ?? null);

      if (resolvedPrice === null) {
        toast.error("Price could not be resolved for this item.");

        return;
      }

      const variantImage = itemHasVariants
        ? getImageForVariant(item, chosenColor, chosenSize, lastVariantSelection)
        : item.image;

      const variantId = itemHasVariants
        ? [item.id, chosenColor, chosenSize].filter(Boolean).join("-")
        : item.id;

      const variants =
        itemHasVariants && (chosenColor || chosenSize)
          ? {
              ...(chosenColor
                ? {
                    color: chosenColor,
                  }
                : {}),
              ...(chosenSize
                ? {
                    size: chosenSize,
                  }
                : {}),
            }
          : null;

      const variantText =
        variants && Object.keys(variants).length
          ? Object.entries(variants)
              .map(([key, value]) => `${key}: ${value}`)
              .join(", ")
          : "";

      const itemWithVariant = {
        ...item,
        id: variantId,
        parentId: item.id,

        ...(chosenColor
          ? {
              selectedColor: chosenColor,
            }
          : {}),

        ...(chosenSize
          ? {
              selectedSize: chosenSize,
            }
          : {}),

        ...(variants ? { variants } : {}),

        variantText,
        variantImage,
        image: variantImage,

        quantity: Number(selectedQty) || 1,

        addedAt: Date.now(),

        status: item.status || "Available",

        variantPrice: resolvedPrice,

        price: resolvedPrice,
      };

      addToCart(itemWithVariant, resolvedPrice);

      toast.success(
        `✅ ${item.name} added to cart (${Number(selectedQty) || 1}${
          itemHasVariants ? ` • ${variantText || "variant"}` : ""
        })`,
      );

      setSelectedItem(null);
      setLastVariantSelection(null);
      setActiveColor(null);
      setActiveSize(null);
      setSelectedQty(1);

      setTimeout(() => {
        try {
          window.scrollTo({
            top: savedScroll,
            behavior: "smooth",
          });
        } catch {
          // Ignore scroll errors
        }
      }, 250);
    } catch (error) {
      console.error("Add to cart error:", error);

      toast.error("Something went wrong while adding to cart");
    } finally {
      setLoadingItemId(null);
    }
  };

  const toggleVisibility = async (item) => {
    try {
      await updateDoc(doc(db, ...folangeProductPath(item.id)), {
        available: !item.available,
      });

      toast.info(`Product is now ${!item.available ? "visible" : "hidden"} to visitors`);
    } catch {
      toast.error("Failed to toggle visibility");
    }
  };

  const confirmDeleteToast = async (item) => {
    if (window.confirm("Are you sure you want to delete this item?")) {
      await deleteDoc(doc(db, ...folangeProductPath(item.id)));

      toast.success("Item deleted");
      setSelectedItem(null);
    }
  };

  const navItems = [
    { link: "Home", path: "home" },
    { link: "Store", path: "store" },
    { link: "Academy", path: "academy" },
    { link: "Gallery", path: "gallery" },
    { link: "About", path: "about" },
    { link: "Services", path: "services" },
    { link: "Spa", path: "services" },
    { link: "FAQ", path: "faq" },
    { link: "Contact", path: "contact" },
    { link: "Profile", path: "profile" },
  ];

  const searchItems = Array.isArray(filteredCookingItems) ? filteredCookingItems : [];
  const cartCount = Array.isArray(cart) ? cart.length : 0;
  const noteCount = Array.isArray(notes) ? notes.length : 0;

  const username = currentUser?.displayName || currentUser?.email?.split("@")[0] || "My account";

  const modalRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setSelectedItem(null);
        setLastVariantSelection(null);
        setActiveColor(null);
        setActiveSize(null);
        setSelectedQty(1);
      }
    };

    if (selectedItem) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedItem]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "";

    try {
      if (typeof timestamp.toDate === "function") {
        return timestamp.toDate().toLocaleString();
      }

      if (timestamp.seconds) {
        return new Date(timestamp.seconds * 1000).toLocaleString();
      }

      return new Date(timestamp).toLocaleString();
    } catch {
      return "";
    }
  };

  const userIsAdmin = Boolean(isAdmin);

  const openFromSearch = (item) => {
    if (!item) return;

    const isPreOrder = normalize(item?.status) === "preorder";

    if (!userIsAdmin && item?.available === false && !isPreOrder) {
      toast.info("This product is currently hidden.");

      return;
    }

    setSavedScroll(window.scrollY);
    setSelectedItem(item);

    if (Array.isArray(item?.colors) && item.colors.length > 0) {
      setActiveColor(getName(item.colors[0]) || null);
    } else {
      setActiveColor(null);
    }

    setActiveSize(null);
    setSelectedQty(1);
    setLastVariantSelection(null);
    setSearchQuery("");
  };

  return (
    <>
      <ToastContainer />

      <style>{`
        .folange-search input {
          background: #ffffff !important;
          color: #463a28 !important;
          border: 1px solid #e5d6b5 !important;
          border-radius: 0.75rem;
          caret-color: #8a6517;
        }
        .folange-search input::placeholder {
          color: #8b8071 !important;
        }
        .folange-search input:focus {
          outline: 2px solid #9a7428 !important;
          outline-offset: 2px;
          box-shadow: 0 0 0 4px rgba(212, 175, 55, 0.08) !important;
        }
        .folange-search button {
          color: #8a6517;
        }
        .folange-nav-link:focus-visible,
        .folange-action:focus-visible {
          outline: 2px solid #9a7428;
          outline-offset: 4px;
        }
      `}</style>

      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-40 border-b border-[#E7D8B8] bg-[#FFFCF7] text-[#3F3528] shadow-[0_8px_28px_rgba(99,76,34,0.08)]"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-3 items-center gap-3 py-3 lg:flex lg:justify-between lg:py-4">
            <button
              type="button"
              onClick={toggleMenu}
              aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={isMenuOpen}
              aria-controls="folange-mobile-menu"
              className="folange-action flex h-11 w-11 items-center justify-center rounded-full border border-[#E5D6B5] text-[#8A6517] transition hover:bg-[#F3E9D7] lg:hidden"
            >
              {isMenuOpen ? <FaXmark size={21} /> : <FaBarsStaggered size={21} />}
            </button>

            <a
              href="#home"
              onClick={(event) => handleScrollAdjust(event, "home")}
              aria-label="Folange Beauty Lounge home"
              className="folange-nav-link flex items-center justify-center gap-3 justify-self-center lg:justify-start"
            >
              <img
                src={FOLANGE_LOGO}
                alt="Folange Beauty Lounge"
                width={80}
                height={80}
                decoding="async"
                className="h-16 w-16 shrink-0 rounded-full object-contain sm:h-20 sm:w-20"
              />
              <span className="hidden lg:block">
                <span
                  className="block text-3xl leading-none text-[#8A6517]"
                  style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                >
                  Folange
                </span>
                <span className="mt-2 block text-[10px] uppercase tracking-[0.3em] text-[#8A6517]">
                  Beauty Lounge
                </span>
                <span className="mt-1 block text-[11px] text-[#7D7262]">
                  Beauty · Wellness · Spa · Education
                </span>
              </span>
            </a>

            <div className="flex items-center justify-end gap-3 justify-self-end sm:gap-5">
              {currentUser && (
                <div className="hidden text-right lg:block">
                  <span className="block text-[10px] uppercase tracking-widest text-[#7D7262]">
                    Welcome
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDashboard(true)}
                    className="folange-action mt-1 max-w-[160px] truncate text-sm text-[#8A6517] hover:text-[#3F3528]"
                    title={username}
                  >
                    {username}
                  </button>
                </div>
              )}

              {currentUser && userIsAdmin && (
                <button
                  type="button"
                  onClick={() => setShowInbox(true)}
                  className="folange-action relative hidden flex-col items-center gap-1 text-[#8A6517] hover:text-[#3F3528] lg:flex"
                  aria-label={`Open inbox, ${noteCount} notes`}
                >
                  <FaEnvelope size={22} />
                  <span className="text-[10px] text-[#6F6455]">Inbox</span>
                  {noteCount > 0 && (
                    <span className="absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#D4AF37] px-1 text-[10px] font-bold text-[#3F3528]">
                      {noteCount}
                    </span>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={(event) => handleScrollAdjust(event, "profile")}
                className="folange-action flex flex-col items-center gap-1 text-[#8A6517] transition hover:text-[#3F3528]"
                aria-label={currentUser ? "Open my account" : "Sign in to your account"}
              >
                <FaUserCircle className="h-6 w-6 sm:h-7 sm:w-7" />
                <span className="text-[10px] text-[#6F6455]">Account</span>
              </button>

              <button
                type="button"
                onClick={handleToggleCart}
                className="folange-action relative flex flex-col items-center gap-1 text-[#8A6517] transition hover:text-[#3F3528]"
                aria-label={`Open shopping bag, ${cartCount} items`}
                aria-expanded={Boolean(isCartOpen)}
              >
                <FaBagShopping className="h-6 w-6 sm:h-7 sm:w-7" />
                <span className="text-[10px] text-[#6F6455]">Bag</span>
                <span className="absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#D4AF37] px-1 text-[10px] font-bold text-[#3F3528]">
                  {cartCount}
                </span>
              </button>

              {currentUser && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="folange-action hidden rounded-full border border-[#E5D6B5] px-3 py-2 text-xs text-[#8A6517] transition hover:bg-[#F3E9D7] lg:block"
                >
                  Logout
                </button>
              )}
            </div>
          </div>

          <nav aria-label="Main navigation" className="hidden border-t border-[#EADFCB] lg:block">
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 py-4 xl:gap-x-8">
              {navItems.map(({ link, path }) => (
                <li key={`${link}-${path}`}>
                  <a
                    href={`#${path}`}
                    onClick={(event) => handleScrollAdjust(event, path)}
                    className="folange-nav-link relative block pb-1 text-xs font-medium uppercase tracking-widest text-[#534735] transition hover:text-[#8A6517] after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-[#D4AF37] after:transition-transform hover:after:scale-x-100"
                  >
                    {path === "profile" && currentUser ? "My Account" : link}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="relative mx-auto max-w-3xl pb-3">
            <div className="folange-search">
              <SearchBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
            </div>

            {searchQuery && (
              <div
                className="absolute inset-x-0 top-full mt-1 max-h-80 overflow-y-auto rounded-xl border border-[#D4AF37] bg-[#FFFCF5] text-[#211B10] shadow-2xl"
                role="region"
                aria-label="Product search results"
              >
                {searchItems.length > 0 ? (
                  searchItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openFromSearch(item)}
                      className="flex w-full items-center gap-3 border-b border-[#EEE2C4] p-3 text-left transition last:border-b-0 hover:bg-[#F7EFD9] focus:bg-[#F7EFD9]"
                    >
                      <img
                        src={item.image || "/placeholder.jpg"}
                        alt={item.name || "Folange product"}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {capitalizeWords(item.name || "Product")}
                        </span>
                        <span className="block text-xs text-gray-500">{item.category}</span>
                        <span className="mt-1 block text-sm font-semibold text-[#8A6517]">
                          ₦
                          {Number(item.priceDiscounted ?? item.priceOriginal ?? 0).toLocaleString()}
                        </span>
                        {item.status && (
                          <span className="mt-1 block text-xs text-gray-500">
                            Status: {item.status}
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="p-4 text-center text-sm text-gray-600">
                    No Folange products match your search.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div aria-hidden="true" style={{ height: headerHeight }} />

      {isMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setIsMenuOpen(false)}
            className="absolute inset-0 bg-[#4A3B24] bg-opacity-30"
          />
          <aside
            id="folange-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Folange navigation"
            className="relative flex h-full w-[85%] max-w-sm flex-col overflow-y-auto border-r border-[#E7D8B8] bg-[#FFFCF7] text-[#3F3528] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#EADFCB] p-5">
              <a
                href="#home"
                onClick={(event) => handleScrollAdjust(event, "home")}
                className="folange-nav-link flex items-center gap-3"
              >
                <img
                  src={FOLANGE_LOGO}
                  alt="Folange Beauty Lounge"
                  className="h-16 w-16 rounded-full object-contain"
                />
                <span>
                  <span
                    className="block text-2xl text-[#8A6517]"
                    style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                  >
                    Folange
                  </span>
                  <span className="block text-[9px] uppercase tracking-[0.2em] text-[#8A6517]">
                    Beauty Lounge
                  </span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                autoFocus
                className="folange-action flex h-10 w-10 items-center justify-center rounded-full border border-[#E5D6B5] text-[#8A6517] hover:bg-[#F3E9D7]"
                aria-label="Close navigation menu"
              >
                <FaXmark size={20} />
              </button>
            </div>

            {currentUser && (
              <p className="px-6 pt-5 text-sm text-[#7D7262]">
                Welcome, <span className="font-medium text-[#8A6517]">{username}</span>
              </p>
            )}

            <nav aria-label="Mobile navigation" className="px-4 py-4">
              <ul className="space-y-1">
                {navItems.map(({ link, path }) => (
                  <li key={`${link}-${path}`}>
                    <a
                      href={`#${path}`}
                      onClick={(event) => handleScrollAdjust(event, path)}
                      className="folange-nav-link block rounded-lg px-3 py-3 text-sm font-medium uppercase tracking-wider text-[#534735] transition hover:bg-[#F3E9D7] hover:text-[#8A6517]"
                    >
                      {path === "profile" && currentUser ? "My Account" : link}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="mx-5 mt-auto space-y-3 border-t border-[#EADFCB] py-5">
              {currentUser && userIsAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setShowInbox(true);
                    setIsMenuOpen(false);
                  }}
                  className="folange-action flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#8A6517] hover:bg-[#F3E9D7]"
                >
                  <FaEnvelope />
                  <span>Inbox</span>
                  <span className="ml-auto rounded-full bg-[#D4AF37] px-2 py-0.5 text-xs font-bold text-[#3F3528]">
                    {noteCount}
                  </span>
                </button>
              )}
              {currentUser && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="folange-action w-full rounded-lg border border-[#E5D6B5] px-3 py-2 text-left text-sm text-[#8A6517] hover:bg-[#F3E9D7]"
                >
                  Logout
                </button>
              )}
              <p className="text-center text-[10px] uppercase tracking-wider text-[#7D7262]">
                Beauty · Wellness · Spa · Education
              </p>
            </div>
          </aside>
        </div>
      )}

      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white shadow-lg z-50 transform transition-transform duration-300 ${
          isCartOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <Cart />
      </div>

      {selectedItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div
            ref={modalRef}
            className="bg-[#FFFCF5] p-6 rounded-lg max-w-lg w-full relative shadow-xl overflow-y-auto max-h-[90vh] pb-[80px]"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => {
                setSelectedItem(null);
                setLastVariantSelection(null);
                setActiveColor(null);
                setActiveSize(null);
                setSelectedQty(1);

                setTimeout(() => {
                  try {
                    window.scrollTo({
                      top: savedScroll,
                      behavior: "smooth",
                    });
                  } catch {
                    // Ignore scroll errors
                  }
                }, 250);
              }}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>

            <h2 className="text-2xl font-bold mb-2 text-center">
              {capitalizeWords(selectedItem.name)}
            </h2>

            <img
              src={getImageForVariant(
                selectedItem,
                activeColor || getName(selectedItem.colors?.[0]) || null,
                activeSize || null,
                lastVariantSelection,
              )}
              alt={selectedItem.name}
              className="w-full h-64 object-cover rounded mb-4"
            />

            <p className="mb-2 text-sm font-semibold">
              Status:{" "}
              <span
                className={`px-2 py-1 text-xs rounded text-[#16120A] ${
                  normalize(selectedItem.status) === "available" ? "bg-green-600" : "bg-yellow-600"
                }`}
              >
                {selectedItem.status || "Available"}
              </span>
            </p>

            <p className="mb-2 text-sm italic text-gray-600">
              Category: {selectedItem.category || "Uncategorized"}
            </p>

            {selectedItem.trackingStage && (
              <p className="mb-2 text-sm font-semibold">
                Tracking Stage:{" "}
                <span className="px-2 py-1 text-xs rounded bg-gray-500 text-white">
                  {selectedItem.trackingStage}
                </span>
              </p>
            )}

            <p className="mb-4 text-gray-700 leading-relaxed">
              {selectedItem.description || "No description available."}
            </p>

            {Array.isArray(selectedItem.colors) && selectedItem.colors.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-semibold mb-2">Colors:</p>

                <select
                  value={activeColor || ""}
                  onChange={(event) => {
                    const nextColor = event.target.value || null;

                    setActiveColor(nextColor);

                    setLastVariantSelection("color");
                  }}
                  className="w-full border px-3 py-2 rounded"
                >
                  <option value="">Select color</option>

                  {selectedItem.colors.map((color, index) => {
                    const name = getName(color) || `color-${index}`;

                    const price =
                      color?.priceDiscounted ??
                      color?.priceOriginal ??
                      selectedItem.priceDiscounted ??
                      selectedItem.priceOriginal ??
                      null;

                    const labelPrice = price ? ` - ₦${Number(price).toLocaleString()}` : "";

                    return (
                      <option key={name} value={name}>
                        {name}
                        {labelPrice}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {Array.isArray(selectedItem.sizes) && selectedItem.sizes.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-semibold mb-2">Sizes:</p>

                <select
                  value={activeSize || ""}
                  onChange={(event) => {
                    const nextSize = event.target.value || null;

                    setActiveSize(nextSize);

                    setLastVariantSelection("size");
                  }}
                  className="w-full border px-3 py-2 rounded"
                >
                  <option value="">Select size</option>

                  {selectedItem.sizes.map((size, index) => {
                    const name = getName(size) || `size-${index}`;

                    const price =
                      size?.priceDiscounted ??
                      size?.priceOriginal ??
                      selectedItem.priceDiscounted ??
                      selectedItem.priceOriginal ??
                      null;

                    const labelPrice = price ? ` - ₦${Number(price).toLocaleString()}` : "";

                    return (
                      <option key={name} value={name}>
                        {name}
                        {labelPrice}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <p className="mb-2 text-gray-400 line-through">
              Original: ₦{Number(selectedItem.priceOriginal ?? 0).toLocaleString()}
            </p>

            <p className="font-semibold text-[#8A6517] text-lg mb-2">
              Discount: ₦
              {Number(
                hasVariants(selectedItem)
                  ? getVariantPrice(selectedItem, activeColor, activeSize, lastVariantSelection)
                  : (selectedItem.priceDiscounted ?? selectedItem.priceOriginal ?? 0),
              ).toLocaleString()}
            </p>

            {selectedItem.shipmentFee && (
              <p className="text-sm text-gray-700 mb-4">
                🚚 Shipment Fee: ₦{Number(selectedItem.shipmentFee).toLocaleString()}{" "}
                <span className="italic text-gray-500">(paid separately)</span>
              </p>
            )}

            <p className="mb-3 text-sm font-semibold">
              Stock:{" "}
              <span className="px-2 py-1 text-xs rounded bg-gray-800 text-white">
                {getApproxStock(selectedItem)}
              </span>
            </p>

            <div className="mt-2 flex items-center gap-3">
              <p className="text-sm font-semibold">Quantity:</p>

              <button
                type="button"
                className="px-3 py-1 border rounded"
                onClick={() => setSelectedQty((quantity) => Math.max(1, Number(quantity || 1) - 1))}
              >
                -
              </button>

              <input
                type="number"
                min="1"
                value={selectedQty}
                onChange={(event) => {
                  const stock = getApproxStock(selectedItem);

                  if (stock > 0) {
                    const next = clampQtyToStock(event.target.value, stock);

                    setSelectedQty(next);

                    if (Number(event.target.value) > stock) {
                      toast.info(`Only ${stock} left for this selection.`);
                    }
                  } else {
                    setSelectedQty(Math.max(1, Number(event.target.value || 1)));
                  }
                }}
                className="w-20 border px-2 py-1 rounded text-center"
              />

              <button
                type="button"
                className="px-3 py-1 border rounded"
                onClick={() => {
                  const stock = getApproxStock(selectedItem);

                  setSelectedQty((quantity) => {
                    const next = Number(quantity || 1) + 1;

                    if (stock > 0 && next > stock) {
                      toast.info(`Only ${stock} left for this selection.`);

                      return stock;
                    }

                    return next;
                  });
                }}
              >
                +
              </button>

              <span className="text-xs text-gray-500 ml-auto">
                Max: {getApproxStock(selectedItem) || "—"}
              </span>
            </div>

            <div className="flex flex-col gap-3 mt-6">
              <button
                type="button"
                onClick={() => handleAddToCartDetailed(selectedItem)}
                disabled={loadingItemId === selectedItem.id}
                className={`px-4 py-2 rounded text-[#16120A] ${
                  loadingItemId === selectedItem.id
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-[#D4AF37] hover:bg-[#E7C65C]"
                }`}
              >
                {loadingItemId === selectedItem.id ? "Adding..." : `Add ${selectedQty} to Cart`}
              </button>

              {currentUser && userIsAdmin && (
                <div className="flex justify-end gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();

                      toggleVisibility(selectedItem);
                    }}
                    className="text-gray-600 hover:text-gray-800 flex items-center gap-2 border px-3 py-2 rounded"
                    title="Toggle visibility"
                  >
                    {selectedItem.available ? (
                      <>
                        <AiFillEye />
                        Visible
                      </>
                    ) : (
                      <>
                        <AiFillEyeInvisible />
                        Hidden
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => toast.info("Edit modal logic goes here")}
                    className="bg-[#D4AF37] text-[#16120A] px-4 py-2 rounded hover:bg-[#E7C65C]"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => confirmDeleteToast(selectedItem)}
                    className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showInbox && userIsAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 p-4">
          <div className="bg-[#FFFCF5] p-4 md:p-6 rounded-md w-full max-w-[700px] relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowInbox(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>

            <h2 className="text-2xl font-bold mb-4 text-center">Inbox - Notes</h2>

            {Array.isArray(notes) && notes.length > 0 ? (
              <div className="flex flex-col gap-4">
                {notes
                  .slice()
                  .sort((firstNote, secondNote) => {
                    const firstTime = firstNote.timestamp?.seconds
                      ? firstNote.timestamp.seconds
                      : firstNote.timestamp
                        ? new Date(firstNote.timestamp).getTime() / 1000
                        : 0;

                    const secondTime = secondNote.timestamp?.seconds
                      ? secondNote.timestamp.seconds
                      : secondNote.timestamp
                        ? new Date(secondNote.timestamp).getTime() / 1000
                        : 0;

                    return secondTime - firstTime;
                  })
                  .map((note) => (
                    <NoteItem key={note.id} note={note} formatTimestamp={formatTimestamp} />
                  ))}
              </div>
            ) : (
              <p className="text-center text-gray-500">No notes available.</p>
            )}
          </div>
        </div>
      )}

      {showSignInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-[#FFFCF5] p-6 rounded-md w-[90%] md:w-[400px] relative">
            <h2 className="text-2xl font-bold mb-4 text-center">Sign In to Folange</h2>

            <form onSubmit={handleSignIn}>
              <input
                type="email"
                placeholder="Email"
                className="w-full mb-4 p-2 border border-gray-300 rounded"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />

              <div className="relative mb-4">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  className="w-full p-2 border border-gray-300 rounded"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />

                {showPassword ? (
                  <AiFillEyeInvisible
                    className="absolute right-3 top-3 text-xl cursor-pointer"
                    onClick={() => setShowPassword((current) => !current)}
                  />
                ) : (
                  <AiFillEye
                    className="absolute right-3 top-3 text-xl cursor-pointer"
                    onClick={() => setShowPassword((current) => !current)}
                  />
                )}
              </div>

              <div className="flex items-center justify-between mb-4">
                <label className="flex items-center text-sm text-gray-600">
                  <input type="checkbox" className="mr-2 accent-[#D4AF37]" /> Remember me
                </label>

                <button
                  type="button"
                  className={`text-sm text-[#8A6517] hover:underline ${
                    resetPasswordLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                  }`}
                  onClick={handleForgotPassword}
                  disabled={resetPasswordLoading}
                >
                  {resetPasswordLoading ? "Sending link..." : "Forgot password?"}
                </button>
              </div>

              <button
                type="submit"
                className="w-full bg-[#D4AF37] text-[#16120A] py-2 rounded hover:bg-[#E7C65C] transition duration-200"
              >
                Sign In to Folange
              </button>

              <p className="text-sm text-center mt-2">
                Don&apos;t have an account?{" "}
                <span
                  onClick={() => {
                    setShowSignInModal(false);

                    setShowSignUpModal(true);
                  }}
                  className="text-[#8A6517] hover:underline cursor-pointer"
                >
                  Create one
                </span>
              </p>
            </form>

            <div className="flex flex-col gap-2 mt-4">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="flex items-center justify-center gap-2 w-full bg-[#D4AF37] text-[#16120A] py-2 rounded hover:bg-[#E7C65C] transition"
              >
                <FaGoogle />
                Continue with Google
              </button>

              <button
                type="button"
                onClick={handleFacebookSignIn}
                className="flex items-center justify-center gap-2 w-full bg-[#D4AF37] text-[#16120A] py-2 rounded hover:bg-[#E7C65C] transition"
              >
                <FaFacebook />
                Continue with Facebook
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowSignInModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {showDashboard && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-[#FFFCF5] p-6 rounded-md w-[90%] md:w-[800px] relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowDashboard(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>

            <Dashboard />
          </div>
        </div>
      )}

      {showSignUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-[#FFFCF5] p-6 rounded-md w-[90%] md:w-[400px] relative">
            <h2 className="text-2xl font-bold mb-4 text-center">Join Folange</h2>

            <form onSubmit={handleSignUp}>
              <input
                type="text"
                name="fullName"
                id="folange-signup-full-name"
                placeholder="Full Name"
                autoComplete="name"
                className="w-full mb-4 p-2 border border-gray-300 rounded"
                value={signUpName}
                onChange={(event) => {
                  setSignUpName(event.target.value);
                }}
                required
              />

              <input
                type="email"
                name="email"
                id="folange-signup-email"
                placeholder="Email"
                autoComplete="email"
                className="w-full mb-4 p-2 border border-gray-300 rounded"
                value={signUpEmail}
                onChange={(event) => setSignUpEmail(event.target.value)}
                required
              />

              <div className="relative mb-4">
                <input
                  type={showSignUpPassword ? "text" : "password"}
                  name="newPassword"
                  id="folange-signup-password"
                  placeholder="Password"
                  autoComplete="new-password"
                  minLength={6}
                  className="w-full p-2 pr-11 border border-gray-300 rounded"
                  value={signUpPassword}
                  onChange={(event) => setSignUpPassword(event.target.value)}
                  required
                />

                <button
                  type="button"
                  onClick={() => setShowSignUpPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-xl text-gray-600 hover:text-[#8A6517] focus:outline-none"
                  aria-label={showSignUpPassword ? "Hide password" : "Show password"}
                  title={showSignUpPassword ? "Hide password" : "Show password"}
                >
                  {showSignUpPassword ? <AiFillEyeInvisible /> : <AiFillEye />}
                </button>
              </div>

              <button
                type="submit"
                disabled={signUpLoading}
                className={`w-full text-[#16120A] py-2 rounded transition duration-200 ${
                  signUpLoading
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-[#D4AF37] hover:bg-[#E7C65C]"
                }`}
              >
                {signUpLoading ? "Creating Account..." : "Sign Up"}
              </button>
            </form>

            <div className="flex flex-col gap-2 mt-4">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="flex items-center justify-center gap-2 w-full bg-[#D4AF37] text-[#16120A] py-2 rounded hover:bg-[#E7C65C] transition"
              >
                <FaGoogle />
                Continue with Google
              </button>

              <button
                type="button"
                onClick={handleFacebookSignIn}
                className="flex items-center justify-center gap-2 w-full bg-[#D4AF37] text-[#16120A] py-2 rounded hover:bg-[#E7C65C] transition"
              >
                <FaFacebook />
                Continue with Facebook
              </button>
            </div>

            <p className="text-sm text-center mt-4">
              Already have an account?{" "}
              <span
                onClick={() => {
                  setShowSignUpModal(false);

                  setShowSignInModal(true);
                }}
                className="text-[#8A6517] hover:underline cursor-pointer"
              >
                Sign in
              </span>
            </p>

            <button
              type="button"
              onClick={() => setShowSignUpModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
