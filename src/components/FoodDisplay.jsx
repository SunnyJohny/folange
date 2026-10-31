import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";

import {
  collection,
  getDocs,
  query,
  orderBy,
  documentId,
  limit,
  startAfter,
  runTransaction,
  addDoc,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  FOLANGE_STORE_ID,
  FOLANGE_MEDIA_ROOT,
  FOLANGE_BROWSER_KEYS,
  FOLANGE_SHIPMENT_EVENT,
  folangeCollectionPath,
  folangeProductPath,
  folangeUserOrdersPath,
  folangeUserOrderPath,
  isFolangeOrderPath,
} from "../config/folangePaths";

// Folange uses dedicated Firestore paths, browser storage, Cloudinary folders,
// product schema, and shipment synchronization. Other stores’ data is not accessed.
const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET;
import { toast } from "react-toastify";
import { useMyContext } from "../Context/MyContext";
import { FaHeart, FaShareAlt, FaFacebook, FaInstagram, FaTwitter, FaWhatsapp, FaSpa } from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { motion, AnimatePresence } from "framer-motion";

export default function CookingItems() {
  // ---------- Local UI & form state ----------
  const [showAddedModalItemId, setShowAddedModalItemId] = useState(null);

  const [newCookingItem, setNewCookingItem] = useState({
    name: "",
    description: "",
    priceOriginal: "",
    priceDiscounted: "",
    image: null,
    category: "",
    sizes: [],
    colors: [],
    colorImages: {},
    sizeImages: {},
    available: true,
    status: "Available",
    trackingStage: "Pending",
    wishes: 0,
    wishedBy: [],
    shipmentFee: "",
    shipmentFeeEnabled: false,
    quantity: 0,
    restockAmount: 0,
  });

  const [colorFiles, setColorFiles] = useState({});
  const [sizeFiles, setSizeFiles] = useState({});
  const [sizeInput, setSizeInput] = useState("");
  const [colorInput, setColorInput] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCookingItem, setEditingCookingItem] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [activeColor, setActiveColor] = useState(null);
  const [activeSize, setActiveSize] = useState(null);
  const [selectedQty, setSelectedQty] = useState(1);
  const [loadingItemId, setLoadingItemId] = useState(null);

  // Admin shipment-fee drafts for products and individual variants.
  const [shipmentFeeDrafts, setShipmentFeeDrafts] = useState({});
  const shipmentUpdateBusy = useRef(false);

  const [tooltipVisible, setTooltipVisible] = useState({});
  const [visibleCount, setVisibleCount] = useState(6);

  // ✅ Local wishlist for guests (NO Firestore writes)
  const [localWishlist, setLocalWishlist] = useState(() => {
    try {
      const raw = localStorage.getItem(FOLANGE_BROWSER_KEYS.wishlist);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [customTrackingInput, setCustomTrackingInput] = useState("");
  const [addModalCustomVisible, setAddModalCustomVisible] = useState(false);
  const [savedScroll, setSavedScroll] = useState(0);

  // NEW: track last variant selection type so price display replaces (not adds)
  const [lastVariantSelection, setLastVariantSelection] = useState(null); // "color" | "size" | null

  // ✅ local preview URLs so size image selection works instantly in Add/Edit
  const [sizePreviewUrls, setSizePreviewUrls] = useState({});
  const [colorPreviewUrls, setColorPreviewUrls] = useState({});

  // ---------- Context ----------
  const {
    addToCart,
    filteredCookingItems = [],
    cookingitems = [],
    capitalizeWords,
    statusFilter,
    currentUser,
    isAdmin,
    filterCategory,
    toggleCart,
    orders = [],
  } = useMyContext();

  // persist local wishlist
  useEffect(() => {
    try {
      localStorage.setItem(FOLANGE_BROWSER_KEYS.wishlist, JSON.stringify(localWishlist));
    } catch {}
  }, [localWishlist]);

  // Keep the open product modal synchronized when an
  // shipment activation or fee correction is made in OrdersTable.
  useEffect(() => {
    const handleShipmentSync = (event) => {
      const detail = event?.detail || {};

      if (detail?.source !== "orders" || detail?.storeId !== FOLANGE_STORE_ID || !detail?.productId) {
        return;
      }

      const applyShipmentUpdate = (item) => {
        if (!item || String(item?.id || "") !== String(detail.productId)) {
          return item;
        }

        if (detail.variantType === "color" || detail.variantType === "size") {
          const collectionName = detail.variantType === "color" ? "colors" : "sizes";

          return {
            ...item,
            [collectionName]: (item?.[collectionName] || []).map((variant) => {
              const variantName = typeof variant === "string" ? variant : variant?.name;

              if (
                String(variantName || "")
                  .trim()
                  .toLowerCase() !==
                String(detail.variantName || "")
                  .trim()
                  .toLowerCase()
              ) {
                return variant;
              }

              return {
                ...(typeof variant === "string" ? { name: variant } : variant),
                shipmentFee: Number(detail.unitFee || 0),
                storedShipmentFee: Number(detail.unitFee || 0),
                shipmentFeeEnabled: Boolean(detail.enabled),
                shipmentReady: Boolean(detail.enabled),
              };
            }),
          };
        }

        return {
          ...item,
          shipmentFee: Number(detail.unitFee || 0),
          storedShipmentFee: Number(detail.unitFee || 0),
          shipmentFeeEnabled: Boolean(detail.enabled),
          shipmentReady: Boolean(detail.enabled),
        };
      };

      setSelectedItem((previous) => applyShipmentUpdate(previous));

      setNewCookingItem((previous) => applyShipmentUpdate(previous));
    };

    window.addEventListener(FOLANGE_SHIPMENT_EVENT, handleShipmentSync);

    return () => {
      window.removeEventListener(FOLANGE_SHIPMENT_EVENT, handleShipmentSync);
    };
  }, []);

  // ✅ FIX: Visitors should NEVER see hidden products.
  // Treat missing "available" as visible.
  const visibleToVisitor = useCallback((item) => item?.available !== false, []);

  const baseCookingItems = useMemo(
    () => (cookingitems || []).filter((i) => (isAdmin ? true : visibleToVisitor(i))),
    [cookingitems, isAdmin, visibleToVisitor],
  );

  const baseFilteredCookingItems = useMemo(
    () => (filteredCookingItems || []).filter((i) => (isAdmin ? true : visibleToVisitor(i))),
    [filteredCookingItems, isAdmin, visibleToVisitor],
  );

  // Cosmetics categories; product field names and storage paths stay the same.
  const categories = [
    "Cleansers & Soaps",
    "Serums & Treatments",
    "Moisturisers & Creams",
    "Sunscreen",
    "Body Care",
    "Hair Care",
    "Makeup",
    "Fragrances",
    "Beauty Tools & Accessories",
    "Gift Sets & Bundles",
  ];

  const getCategoryIcon = () => <FaSpa className="mr-2 inline-block" aria-hidden="true" />;

  // ---------- Helpers ----------
  const getName = (maybeObjOrString) =>
    typeof maybeObjOrString === "string" ? maybeObjOrString : (maybeObjOrString?.name ?? null);

  // Normalize strings for status/filter comparisons.
  const normalize = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  // ✅ generate local preview URLs for selected files (sizes/colors)
  useEffect(() => {
    const next = {};
    for (const [size, file] of Object.entries(sizeFiles || {})) {
      if (file instanceof File) next[size] = URL.createObjectURL(file);
    }

    setSizePreviewUrls((prev) => {
      Object.entries(prev || {}).forEach(([k, url]) => {
        if (!next[k] || next[k] !== url) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }
      });
      return next;
    });

    return () => {
      Object.values(next).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    };
  }, [sizeFiles]);

  useEffect(() => {
    const next = {};
    for (const [color, file] of Object.entries(colorFiles || {})) {
      if (file instanceof File) next[color] = URL.createObjectURL(file);
    }

    setColorPreviewUrls((prev) => {
      Object.entries(prev || {}).forEach(([k, url]) => {
        if (!next[k] || next[k] !== url) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }
      });
      return next;
    });

    return () => {
      Object.values(next).forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    };
  }, [colorFiles]);

  // -------------------------
  // Variant-aware stock helpers
  // -------------------------
  const sumRestockedForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.restockHistory || !Array.isArray(item.restockHistory)) return 0;

    const nameLower = variantName?.toString().toLowerCase().trim();

    return item.restockHistory
      .filter((r) => {
        if (!r) return false;
        if (r.color && r.color.toString().toLowerCase().trim() === nameLower) return true;
        if (r.size && r.size.toString().toLowerCase().trim() === nameLower) return true;
        if (r.variantName && r.variantName.toString().toLowerCase().trim() === nameLower) return true;
        if (r.variant && r.variant.toString().toLowerCase().trim() === nameLower) return true;
        if (r.note && r.note.toString().toLowerCase().includes(nameLower)) return true;
        return false;
      })
      .reduce((s, e) => s + (Number(e?.quantity || 0) || 0), 0);
  };

  const handleQtyEditAttempt = (e) => {
    try {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
    } catch {}

    toast.info("Stock quantities are managed in Inventory. Please use Inventory → Restock.");

    try {
      e.target.blur?.();
    } catch {}
  };

  const sumSoldForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.soldHistory || !Array.isArray(item.soldHistory)) return 0;

    const nameLower = variantName?.toString().toLowerCase().trim();

    return item.soldHistory
      .filter((r) => {
        if (!r) return false;
        if (r.color && r.color.toString().toLowerCase().trim() === nameLower) return true;
        if (r.size && r.size.toString().toLowerCase().trim() === nameLower) return true;
        if (r.variantName && r.variantName.toString().toLowerCase().trim() === nameLower) return true;
        if (r.variant && r.variant.toString().toLowerCase().trim() === nameLower) return true;
        if (r.note && r.note.toString().toLowerCase().includes(nameLower)) return true;
        return false;
      })
      .reduce((s, e) => s + (Number(e?.quantity || 0) || 0), 0);
  };

  const computeTotalStock = (item) => {
    if (!item) return 0;

    const hasRestockHistory = Array.isArray(item?.restockHistory) && item.restockHistory.length > 0;
    const hasSoldHistory = Array.isArray(item?.soldHistory) && item.soldHistory.length > 0;

    const names = new Set();

    if (Array.isArray(item?.colors)) {
      item.colors.forEach((c) => {
        const n = typeof c === "string" ? c : c?.name;
        if (n) names.add(n.toString().trim());
      });
    }

    if (Array.isArray(item?.sizes)) {
      item.sizes.forEach((s) => {
        const n = typeof s === "string" ? s : s?.name;
        if (n) names.add(n.toString().trim());
      });
    }

    (item?.restockHistory || []).forEach((r) => {
      const n = r?.color || r?.size || r?.variantName || r?.variant;
      if (n) names.add(n.toString().trim());
    });

    (item?.soldHistory || []).forEach((s) => {
      const n = s?.color || s?.size || s?.variantName || s?.variant;
      if (n) names.add(n.toString().trim());
    });

    if (names.size > 0 && (hasRestockHistory || hasSoldHistory)) {
      let total = 0;
      names.forEach((name) => {
        const restocked = sumRestockedForVariant(item, name);
        const sold = sumSoldForVariant(item, name);
        total += Math.max(0, restocked - sold);
      });
      return Math.max(0, total);
    }

    if (hasRestockHistory || hasSoldHistory) {
      const restockedTotal = (item?.restockHistory || []).reduce(
        (acc, r) => acc + (Number(r?.quantity || 0) || 0),
        0,
      );
      const soldTotal = (item?.soldHistory || []).reduce(
        (acc, s) => acc + (Number(s?.quantity || 0) || 0),
        0,
      );
      return Math.max(0, restockedTotal - soldTotal);
    }

    return Number(item.quantity || 0);
  };

  const getVariantQuantity = (item, colorName, sizeName, lastSelection = null) => {
    if (!item) return 0;

    const hasVariantsFlag =
      (Array.isArray(item?.colors) && item.colors.length > 0) ||
      (Array.isArray(item?.sizes) && item.sizes.length > 0);

    const hasHistoryFlag =
      (Array.isArray(item?.restockHistory) && item.restockHistory.length > 0) ||
      (Array.isArray(item?.soldHistory) && item.soldHistory.length > 0);

    if (!hasVariantsFlag && !hasHistoryFlag) return Number(item.quantity || 0);

    let variantName = null;

    if (lastSelection === "size") {
      variantName = (sizeName && sizeName.toString().trim()) || null;
      if (!variantName) variantName = (colorName && colorName.toString().trim()) || null;
    } else if (lastSelection === "color") {
      variantName = (colorName && colorName.toString().trim()) || null;
      if (!variantName) variantName = (sizeName && sizeName.toString().trim()) || null;
    } else {
      variantName =
        (colorName && colorName.toString().trim()) || (sizeName && sizeName.toString().trim()) || null;
    }

    if (variantName) {
      const restocked = sumRestockedForVariant(item, variantName);
      const sold = sumSoldForVariant(item, variantName);
      return Math.max(0, restocked - sold);
    }

    return computeTotalStock(item);
  };

  const clampQtyToStock = (qty, stock) => {
    const q = Number(qty || 1);
    const s = Number(stock || 0);
    if (!Number.isFinite(q) || q <= 0) return 1;
    if (!Number.isFinite(s) || s <= 0) return 1;
    return Math.min(q, s);
  };

  const getSelectedItemCurrentStock = (item) => {
    if (!item) return 0;
    return getVariantQuantity(item, activeColor, activeSize, lastVariantSelection);
  };

  // ---------- Other helpers ----------
  const hasVariants = (item) =>
    (Array.isArray(item?.colors) && item.colors.length > 0) ||
    (Array.isArray(item?.sizes) && item.sizes.length > 0);

  const getVariantPrice = (item, colorName, sizeName, lastSelection = null) => {
    const toNum = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const basePrice = toNum(item.priceDiscounted) ?? toNum(item.priceOriginal) ?? 0;

    if (!hasVariants(item)) return basePrice;

    const sizeObj = sizeName && (item.sizes || []).find((s) => getName(s) === sizeName);

    const colorObj = colorName && (item.colors || []).find((c) => getName(c) === colorName);

    const sizePrice = sizeObj && (toNum(sizeObj.priceDiscounted) ?? toNum(sizeObj.priceOriginal));

    const colorPrice = colorObj && (toNum(colorObj.priceDiscounted) ?? toNum(colorObj.priceOriginal));

    if (lastSelection === "size") return sizePrice ?? colorPrice ?? basePrice;
    if (lastSelection === "color") return colorPrice ?? sizePrice ?? basePrice;

    return sizePrice ?? colorPrice ?? basePrice;
  };

  const getImageForColor = (item, color) => {
    const colorName = getName(color);
    return (item.colorImages && item.colorImages[colorName]) || item.image || "/placeholder.jpg";
  };

  const getImageForVariant = (item, colorName, sizeName, lastSelection = null) => {
    if (!item) return "/placeholder.jpg";

    const c = colorName ? String(colorName).trim() : null;
    const s = sizeName ? String(sizeName).trim() : null;

    const sizeUrl = s ? item?.sizeImages?.[s] : null;
    const colorUrl = c ? item?.colorImages?.[c] : null;

    if (lastSelection === "size") return sizeUrl || colorUrl || item.image || "/placeholder.jpg";
    if (lastSelection === "color") return colorUrl || sizeUrl || item.image || "/placeholder.jpg";

    return sizeUrl || colorUrl || item.image || "/placeholder.jpg";
  };

  // ---------- Input Handlers ----------
  const handleInputChange = (e) => {
    const { name, value, files, type, checked } = e.target;

    if (name === "image") {
      setNewCookingItem((prev) => ({ ...prev, image: files[0] || null }));
    } else if (name && name.startsWith("color-file-")) {
      const color = name.replace("color-file-", "");
      const file = files[0] || null;
      setColorFiles((prev) => ({ ...prev, [color]: file }));
    } else if (name && name.startsWith("size-file-")) {
      const size = name.replace("size-file-", "");
      const file = files[0] || null;
      setSizeFiles((prev) => ({ ...prev, [size]: file }));
    } else if (type === "checkbox") {
      setNewCookingItem((prev) => ({ ...prev, [name]: checked }));
    } else {
      setNewCookingItem((prev) => ({ ...prev, [name]: value }));
      if (name === "trackingStage") {
        if (value === "Custom") setAddModalCustomVisible(true);
        else setAddModalCustomVisible(false);
      }
    }
  };

  const addArrayValue = (type, value) => {
    if (!value || !value.toString().trim()) return;

    const v = value.toString().trim();

    setNewCookingItem((prev) => {
      const arr = prev[type] || [];
      if (arr.some((x) => getName(x) === v)) return prev;

      const newEntry = {
        name: v,
        priceOriginal: "",
        priceDiscounted: "",
        quantity: 0,
        shipmentFee: "",
        shipmentFeeEnabled: false,
        shipmentReady: false,
      };

      const next = {
        ...prev,
        [type]: [...arr, newEntry],
      };

      if (type === "colors") {
        next.colorImages = {
          ...(prev.colorImages || {}),
          [v]: prev.colorImages?.[v] || null,
        };
      }

      if (type === "sizes") {
        next.sizeImages = {
          ...(prev.sizeImages || {}),
          [v]: prev.sizeImages?.[v] || null,
        };
      }

      return next;
    });

    if (type === "sizes") setSizeInput("");
    if (type === "colors") setColorInput("");
  };

  const removeArrayValue = (type, name) => {
    setNewCookingItem((prev) => {
      const next = {
        ...prev,
        [type]: (prev[type] || []).filter((x) => getName(x) !== name),
      };

      if (type === "colors") {
        const imgs = { ...(next.colorImages || {}) };
        delete imgs[name];
        next.colorImages = imgs;
      }

      if (type === "sizes") {
        const imgs = { ...(next.sizeImages || {}) };
        delete imgs[name];
        next.sizeImages = imgs;
      }

      return next;
    });

    setColorFiles((prev) => {
      const c = { ...prev };
      delete c[name];
      return c;
    });

    setSizeFiles((prev) => {
      const s = { ...prev };
      delete s[name];
      return s;
    });
  };

  // ✅ Cloudinary upload helper for Create React App
  // Firestore stores only the returned secure Cloudinary URL.
  const uploadFileAndGetUrl = async (folder, file) => {
    if (!(file instanceof File)) {
      throw new Error("Please select a valid image file.");
    }

    if (!file.type?.startsWith("image/")) {
      throw new Error("Only image files can be uploaded.");
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Image size must not exceed 10MB.");
    }

    if (!CLOUDINARY_CLOUD_NAME) {
      throw new Error("REACT_APP_CLOUDINARY_CLOUD_NAME is missing from your .env file.");
    }

    if (!CLOUDINARY_UPLOAD_PRESET) {
      throw new Error("REACT_APP_CLOUDINARY_UPLOAD_PRESET is missing from your .env file.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", folder);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result?.error?.message || "Cloudinary image upload failed.");
    }

    if (!result?.secure_url) {
      throw new Error("Cloudinary did not return a secure image URL.");
    }

    return result.secure_url;
  };

  // ---------- Add / Update ----------
  const handleSubmitCookingItem = async () => {
    if (!currentUser?.uid || shipmentUpdateBusy.current) return;
    if (editingCookingItem && !isAdmin) {
      toast.error("Only an administrator can edit existing products.");
      return;
    }
    const {
      name,
      description,
      priceOriginal,
      priceDiscounted,
      shipmentFee,
      shipmentFeeEnabled,
      image,
      category,
      available,
      sizes,
      colors,
      colorImages,
      status,
      trackingStage,
      quantity,
      restockAmount,
    } = newCookingItem;

    const safeName = name?.toString().trim() || "Untitled Product";
    const safeDescription = description?.toString().trim() || "";
    const safePriceOriginal = priceOriginal === "" || priceOriginal === undefined ? null : priceOriginal;
    const safePriceDiscounted =
      priceDiscounted === "" || priceDiscounted === undefined ? null : priceDiscounted;
    const hasVariantShipmentControls =
      (Array.isArray(colors) && colors.length > 0) || (Array.isArray(sizes) && sizes.length > 0);

    /*
      Products with colours or sizes use only their variant-level
      shipment fees and readiness switches. Their general product
      shipment fields are deliberately cleared to prevent the receipt
      from falling back to an unrelated top-level fee.
    */
    const safeShipmentFee = hasVariantShipmentControls
      ? null
      : shipmentFee === "" || shipmentFee === undefined
        ? null
        : shipmentFee;

    const safeShipmentFeeEnabled = hasVariantShipmentControls ? false : Boolean(shipmentFeeEnabled);

    if (
      !hasVariantShipmentControls &&
      ((safeShipmentFee !== null &&
        (!Number.isFinite(Number(safeShipmentFee)) || Number(safeShipmentFee) < 0)) ||
        (safeShipmentFeeEnabled && Number(safeShipmentFee || 0) <= 0))
    ) {
      toast.error("Enter a valid shipment fee before enabling shipment.");
      return;
    }
    const invalidVariantFee = [...(colors || []), ...(sizes || [])].some((variant) => {
      const fee = Number(variant?.shipmentFee || 0);
      return !Number.isFinite(fee) || fee < 0 || (variant?.shipmentFeeEnabled && fee <= 0);
    });
    if (invalidVariantFee) {
      toast.error("Each enabled colour/size needs a valid shipment fee greater than zero.");
      return;
    }

    const safeCategory = category?.toString().trim() || "Uncategorized";
    const safeStatus = status || "Available";
    const safeTrackingStage = trackingStage || "Pending";

    const invalidReadyColor = (colors || []).find(
      (color) => color?.shipmentFeeEnabled && Number(color?.shipmentFee || 0) <= 0,
    );

    if (invalidReadyColor) {
      toast.error(`Enter a shipment fee for colour "${getName(invalidReadyColor)}" before marking it ready.`);

      return;
    }

    const invalidReadySize = (sizes || []).find(
      (size) => size?.shipmentFeeEnabled && Number(size?.shipmentFee || 0) <= 0,
    );

    if (invalidReadySize) {
      toast.error(`Enter a shipment fee for size "${getName(invalidReadySize)}" before marking it ready.`);

      return;
    }

    shipmentUpdateBusy.current = true;
    setLoadingItemId("shipment-product-form");
    try {
      const sanitize = (obj) => Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));

      // ✅ avoid extra reads: detect existing from already-loaded items
      const existing =
        name && name.toString().trim()
          ? (baseCookingItems || []).find(
              (i) => i.name?.toString().trim().toLowerCase() === name.toString().trim().toLowerCase(),
            )
          : null;

      // -------------------------
      // RESTOCK EXISTING (no edit mode)
      // -------------------------
      if (!editingCookingItem && existing) {
        if (!isAdmin) {
          toast.info("This product already exists. Only an administrator can restock it.");
          return;
        }
        const parsedNewColors = (colors || []).map((c) => ({
          name: getName(c),
          priceOriginal: c.priceOriginal || "",
          priceDiscounted: c.priceDiscounted || "",
          quantity: Number(c.quantity || 0),
          shipmentFee: c.shipmentFee === "" || c.shipmentFee === undefined ? "" : Number(c.shipmentFee || 0),
          shipmentFeeEnabled: Boolean(c.shipmentFeeEnabled),
          shipmentReady: Boolean(c.shipmentFeeEnabled),
        }));

        const parsedNewSizes = (sizes || []).map((s) => ({
          name: getName(s),
          priceOriginal: s.priceOriginal || "",
          priceDiscounted: s.priceDiscounted || "",
          quantity: Number(s.quantity || 0),
          shipmentFee: s.shipmentFee === "" || s.shipmentFee === undefined ? "" : Number(s.shipmentFee || 0),
          shipmentFeeEnabled: Boolean(s.shipmentFeeEnabled),
          shipmentReady: Boolean(s.shipmentFeeEnabled),
        }));

        const qtyToAddTopLevel = parseInt(quantity || 0, 10);

        let totalDelta = 0;
        const existingColors = existing.colors || [];
        const existingSizes = existing.sizes || [];

        const mergedColorsMap = {};
        existingColors.forEach((c) => {
          mergedColorsMap[getName(c)] = {
            ...c,
            quantity: Number(c.quantity || 0),
          };
        });

        parsedNewColors.forEach((nc) => {
          const key = nc.name;
          if (!key) return;
          const existingC = mergedColorsMap[key];
          if (existingC) {
            if (nc.quantity > 0) {
              mergedColorsMap[key] = {
                ...existingC,
                priceOriginal: nc.priceOriginal || existingC.priceOriginal,
                priceDiscounted: nc.priceDiscounted || existingC.priceDiscounted,
                shipmentFee: nc.shipmentFee !== "" ? nc.shipmentFee : existingC.shipmentFee || "",
                shipmentFeeEnabled: Boolean(nc.shipmentFeeEnabled),
                shipmentReady: Boolean(nc.shipmentFeeEnabled),
                quantity: Number(existingC.quantity || 0) + nc.quantity,
              };
              totalDelta += nc.quantity;
            } else {
              mergedColorsMap[key] = {
                ...existingC,
                priceOriginal: nc.priceOriginal || existingC.priceOriginal,
                priceDiscounted: nc.priceDiscounted || existingC.priceDiscounted,
                shipmentFee: nc.shipmentFee !== "" ? nc.shipmentFee : existingC.shipmentFee || "",
                shipmentFeeEnabled: Boolean(nc.shipmentFeeEnabled),
                shipmentReady: Boolean(nc.shipmentFeeEnabled),
              };
            }
          } else {
            mergedColorsMap[key] = {
              name: key,
              priceOriginal: nc.priceOriginal || "",
              priceDiscounted: nc.priceDiscounted || "",
              shipmentFee: nc.shipmentFee || "",
              shipmentFeeEnabled: Boolean(nc.shipmentFeeEnabled),
              shipmentReady: Boolean(nc.shipmentFeeEnabled),
              quantity: nc.quantity || 0,
            };
            totalDelta += nc.quantity || 0;
          }
        });

        const mergedSizesMap = {};
        existingSizes.forEach((s) => {
          mergedSizesMap[getName(s)] = {
            ...s,
            quantity: Number(s.quantity || 0),
          };
        });

        parsedNewSizes.forEach((ns) => {
          const key = ns.name;
          if (!key) return;
          const existingS = mergedSizesMap[key];
          if (existingS) {
            if (ns.quantity > 0) {
              mergedSizesMap[key] = {
                ...existingS,
                priceOriginal: ns.priceOriginal || existingS.priceOriginal,
                priceDiscounted: ns.priceDiscounted || existingS.priceDiscounted,
                shipmentFee: ns.shipmentFee !== "" ? ns.shipmentFee : existingS.shipmentFee || "",
                shipmentFeeEnabled: Boolean(ns.shipmentFeeEnabled),
                shipmentReady: Boolean(ns.shipmentFeeEnabled),
                quantity: Number(existingS.quantity || 0) + ns.quantity,
              };
              totalDelta += ns.quantity;
            } else {
              mergedSizesMap[key] = {
                ...existingS,
                priceOriginal: ns.priceOriginal || existingS.priceOriginal,
                priceDiscounted: ns.priceDiscounted || existingS.priceDiscounted,
                shipmentFee: ns.shipmentFee !== "" ? ns.shipmentFee : existingS.shipmentFee || "",
                shipmentFeeEnabled: Boolean(ns.shipmentFeeEnabled),
                shipmentReady: Boolean(ns.shipmentFeeEnabled),
              };
            }
          } else {
            mergedSizesMap[key] = {
              name: key,
              priceOriginal: ns.priceOriginal || "",
              priceDiscounted: ns.priceDiscounted || "",
              shipmentFee: ns.shipmentFee || "",
              shipmentFeeEnabled: Boolean(ns.shipmentFeeEnabled),
              shipmentReady: Boolean(ns.shipmentFeeEnabled),
              quantity: ns.quantity || 0,
            };
            totalDelta += ns.quantity || 0;
          }
        });

        if (totalDelta === 0 && qtyToAddTopLevel > 0) {
          totalDelta = qtyToAddTopLevel;
        }

        if (!totalDelta || totalDelta <= 0) {
          toast.error("Product already exists. Enter a positive quantity to restock.");
          setEditingCookingItem(existing);
          setNewCookingItem({
            ...existing,
            image: existing.image || null,
            trackingStage: existing.trackingStage || "Pending",
            quantity: existing.quantity ?? 0,
            restockAmount: 0,
          });
          setShowAddModal(true);
          return;
        }

        const finalColors = Object.values(mergedColorsMap);
        const finalSizes = Object.values(mergedSizesMap);

        // ✅ uploads (only when files exist)
        const finalColorImages = { ...(existing.colorImages || {}) };
        for (const [color, file] of Object.entries(colorFiles || {})) {
          if (!file) continue;
          const url = await uploadFileAndGetUrl(`${FOLANGE_MEDIA_ROOT}/color-images`, file);
          finalColorImages[color] = url;
        }

        const finalSizeImages = { ...(existing.sizeImages || {}) };
        for (const [size, file] of Object.entries(sizeFiles || {})) {
          if (!file) continue;
          const url = await uploadFileAndGetUrl(`${FOLANGE_MEDIA_ROOT}/size-images`, file);
          finalSizeImages[size] = url;
        }

        const itemRef = doc(db, ...folangeProductPath(existing.id));

        const restockEntry = {
          id: crypto?.randomUUID ? crypto.randomUUID() : uuidv4(),
          quantity: totalDelta,
          timestamp: new Date(),
          adminId: currentUser?.uid || "Unknown Admin",
          note: `Variant restock for ${safeName}`,
        };

        await updateDoc(
          itemRef,
          sanitize({
            colors: finalColors,
            sizes: finalSizes,
            colorImages: finalColorImages,
            sizeImages: finalSizeImages,
            available: true,
            restockHistory: arrayUnion(restockEntry),
            quantity: increment(totalDelta),
          }),
        );

        toast.success(`Restocked existing product by ${totalDelta} units`);
        return;
      }

      // -------------------------
      // ADD / EDIT
      // -------------------------
      const docRef = editingCookingItem ? doc(db, ...folangeProductPath(editingCookingItem.id)) : null;

      let mainImageUrl = editingCookingItem?.image || null;

      if (image instanceof File) {
        mainImageUrl = await uploadFileAndGetUrl(FOLANGE_MEDIA_ROOT, image);
      }

      const finalColorImages = { ...(colorImages || {}) };
      for (const [color, file] of Object.entries(colorFiles || {})) {
        if (!file) continue;
        const url = await uploadFileAndGetUrl(`${FOLANGE_MEDIA_ROOT}/color-images`, file);
        finalColorImages[color] = url;
      }

      const finalSizeImages = { ...(newCookingItem.sizeImages || {}) };
      for (const [size, file] of Object.entries(sizeFiles || {})) {
        if (!file) continue;
        const url = await uploadFileAndGetUrl(`${FOLANGE_MEDIA_ROOT}/size-images`, file);
        finalSizeImages[size] = url;
      }

      const updatePayload = {
        name: safeName,
        description: safeDescription,
        priceOriginal: safePriceOriginal,
        priceDiscounted: safePriceDiscounted,
        shipmentFee: safeShipmentFee,
        shipmentFeeEnabled: safeShipmentFeeEnabled,
        shipmentReady: safeShipmentFeeEnabled,
        storedShipmentFee: Number(safeShipmentFee || 0),
        category: safeCategory,
        available,
        sizes,
        colors,
        colorImages: finalColorImages,
        sizeImages: finalSizeImages,
        status: safeStatus,
        trackingStage: safeTrackingStage,
        image: mainImageUrl,
      };

      if (editingCookingItem) {
        const addQtyFromRestock = parseInt(restockAmount || 0, 10);
        if (addQtyFromRestock > 0) {
          updatePayload.quantity = increment(addQtyFromRestock);
          updatePayload.restockHistory = arrayUnion({
            id: crypto?.randomUUID ? crypto.randomUUID() : uuidv4(),
            quantity: addQtyFromRestock,
            timestamp: new Date(),
            adminId: currentUser?.uid || "Unknown Admin",
            note: "Admin restock",
          });
        }

        await updateDoc(docRef, sanitize(updatePayload));
        const savedProduct = { ...editingCookingItem, ...sanitize(updatePayload), id: editingCookingItem.id };
        setSelectedItem((previous) => (previous?.id === savedProduct.id ? savedProduct : previous));
        reportShipmentSync(await synchronizeProductShipmentOrders(savedProduct));
        if (!hasVariantShipmentControls) {
          emitShipmentSync({
            productId: savedProduct.id,
            enabled: safeShipmentFeeEnabled,
            unitFee: Number(safeShipmentFee || 0),
          });
        } else {
          for (const type of ["color", "size"]) {
            for (const entry of savedProduct[type === "color" ? "colors" : "sizes"] || []) {
              emitShipmentSync({
                productId: savedProduct.id,
                variantType: type,
                variantName: getName(entry),
                enabled: Boolean(entry.shipmentFeeEnabled),
                unitFee: Number(entry.shipmentFee || 0),
              });
            }
          }
        }
        toast.success("Product Updated ✔");
      } else {
        let computedQty = 0;
        if ((colors && colors.length > 0) || (sizes && sizes.length > 0)) {
          const sumColors = (colors || []).reduce((acc, c) => acc + (Number(c.quantity || 0) || 0), 0);
          const sumSizes = (sizes || []).reduce((acc, s) => acc + (Number(s.quantity || 0) || 0), 0);
          computedQty = Math.max(sumColors, sumSizes);
        } else {
          computedQty = parseInt(quantity, 10) || 0;
        }

        await addDoc(
          collection(db, ...folangeCollectionPath("cookingitems")),
          sanitize({
            ...updatePayload,
            quantity: computedQty,
            createdAt: serverTimestamp(),
            restockHistory: [
              {
                id: crypto?.randomUUID ? crypto.randomUUID() : uuidv4(),
                quantity: computedQty,
                timestamp: new Date(),
                adminId: currentUser?.uid || "Unknown Admin",
              },
            ],
          }),
        );

        toast.success("Product Added ✔");
      }

      setNewCookingItem({
        name: "",
        description: "",
        priceOriginal: "",
        priceDiscounted: "",
        shipmentFee: null,
        shipmentFeeEnabled: false,
        category: "",
        sizes: [],
        colors: [],
        colorImages: {},
        sizeImages: {},
        available: true,
        status: "Available",
        trackingStage: "Pending",
        quantity: 0,
        restockAmount: 0,
        image: null,
      });

      setEditingCookingItem(null);
      setColorFiles({});
      setSizeFiles({});
      setSizeInput("");
      setColorInput("");
      setShowAddModal(false);
      setAddModalCustomVisible(false);
      setCustomTrackingInput("");
    } catch (error) {
      console.error("Product save failed:", error);
      toast.error(error?.message || "Something went wrong");
    } finally {
      shipmentUpdateBusy.current = false;
      setLoadingItemId(null);
    }
  };

  // ---------- Delete / Visibility ----------
  const confirmDeleteToast = async (item) => {
    if (!window.confirm("Are you sure you want to delete this beauty product?")) return;
    try {
      await deleteDoc(doc(db, ...folangeProductPath(item.id)));
      toast.success("Beauty product deleted");
      setSelectedItem(null);
    } catch (err) {
      toast.error("Failed to delete item");
    }
  };

  const normalizeProductIdentity = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase();

  const cartItemMatchesProduct = (cartItem, product) => {
    if (!cartItem || !product) return false;

    const productIds = [product.id, product.productId, product.productID, product.docId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    const parentIds = [cartItem.parentId, cartItem.productId, cartItem.productID, cartItem.docId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    if (parentIds.length) return parentIds.some((id) => productIds.includes(id));
    const cartId = String(cartItem.id ?? "").trim();
    if (cartId && productIds.includes(cartId)) return true;
    // Legacy generated variant IDs may use the product ID as their prefix.
    if (cartId && productIds.some((id) => cartId.startsWith(`${id}_`) || cartId.startsWith(`${id}-`)))
      return true;
    const productSku = String(product.sku || product.SKU || "").trim();
    const cartSku = String(cartItem.sku || cartItem.SKU || "").trim();
    if (productSku && cartSku) return productSku === cartSku;
    if (cartId) return false;

    const productNames = [product.name, product.title, product.productName, product.productTitle]
      .map(normalizeProductIdentity)
      .filter(Boolean);

    const cartNames = [cartItem.name, cartItem.title, cartItem.productName, cartItem.productTitle]
      .map(normalizeProductIdentity)
      .filter(Boolean);

    return productNames.some((productName) => cartNames.includes(productName));
  };

  const getOrderDocumentReference = (order) => {
    const directPath = String(order?.orderPath || order?.documentPath || order?.ref?.path || "").trim();

    if (directPath) {
      // Never reinterpret an explicit other-store path.
      if (!isFolangeOrderPath(directPath)) return null;
      return doc(db, ...directPath.split("/"));
    }

    const orderId = String(order?.id || "").trim();
    const userId = String(order?.userId || order?.uid || order?.customerId || "").trim();

    // Pathless Context records are accepted only with FOLANGE provenance.
    // All FOLANGE order writers must set storeId and userId; snapshots should
    // also expose orderPath: snapshot.ref.path.
    if (order?.storeId !== FOLANGE_STORE_ID || !userId || !orderId) return null;
    return doc(db, ...folangeUserOrderPath(userId, orderId));
  };

  const getVariantObject = (item, type, variantName) => {
    if (!item || !variantName) return null;

    const collection = type === "color" ? item.colors : item.sizes;

    if (!Array.isArray(collection)) {
      return null;
    }

    const normalizedName = normalizeProductIdentity(variantName);

    return (
      collection.find((variant) => normalizeProductIdentity(getName(variant)) === normalizedName) || null
    );
  };

  const getCartItemVariantName = (cartItem, type) => {
    if (type === "color") {
      return String(
        getName(cartItem?.selectedColor) ||
          getName(cartItem?.variants?.color) ||
          getName(cartItem?.variant?.color) ||
          getName(cartItem?.color) ||
          "",
      ).trim();
    }

    return String(
      getName(cartItem?.selectedSize) ||
        getName(cartItem?.variants?.size) ||
        getName(cartItem?.variant?.size) ||
        getName(cartItem?.size) ||
        "",
    ).trim();
  };

  const cartItemMatchesProductVariant = (cartItem, product, variantType, variantName) => {
    if (!cartItemMatchesProduct(cartItem, product)) {
      return false;
    }

    const controllingType = cartItem?.shipmentVariant?.type || cartItem?.lastVariantSelection;
    if (controllingType && controllingType !== variantType) return false;

    const cartVariantName = getCartItemVariantName(cartItem, variantType);

    return normalizeProductIdentity(cartVariantName) === normalizeProductIdentity(variantName);
  };

  const getSelectedVariantShipmentConfig = (item, colorName, sizeName, lastSelection = null) => {
    const colorVariant = getVariantObject(item, "color", colorName);

    const sizeVariant = getVariantObject(item, "size", sizeName);

    const resolveVariant = (variant, type) => {
      if (!variant || typeof variant !== "object") return null;
      if (
        !["shipmentFee", "storedShipmentFee", "shipmentFeeEnabled", "shipmentReady"].some((field) =>
          Object.prototype.hasOwnProperty.call(variant, field),
        )
      )
        return null;

      return {
        type,
        name: getName(variant),
        enabled: Boolean(variant.shipmentFeeEnabled ?? variant.shipmentReady),
        ready: Boolean(variant.shipmentFeeEnabled ?? variant.shipmentReady),
        fee: Number(variant.shipmentFee ?? variant.storedShipmentFee ?? 0),
      };
    };

    const colorConfig = resolveVariant(colorVariant, "color");

    const sizeConfig = resolveVariant(sizeVariant, "size");

    /*
      The most recently selected variant controls shipment.
      If no last selection is available, colour takes priority,
      followed by size. Product-level shipment is only a fallback
      when no selected variant has its own configuration.
    */
    if (lastSelection === "size" && sizeConfig) {
      return sizeConfig;
    }

    if (lastSelection === "color" && colorConfig) {
      return colorConfig;
    }

    if (colorConfig) return colorConfig;
    if (sizeConfig) return sizeConfig;

    return {
      type: "product",
      name: item?.name || "Product",
      enabled: Boolean(item?.shipmentFeeEnabled),
      ready: Boolean(item?.shipmentFeeEnabled),
      fee: Number(item?.shipmentFee || 0),
    };
  };

  const emitShipmentSync = ({ productId, variantType = "product", variantName = "", enabled, unitFee }) => {
    try {
      window.dispatchEvent(
        new CustomEvent(FOLANGE_SHIPMENT_EVENT, {
          detail: {
            source: "products",
            storeId: FOLANGE_STORE_ID,
            productId,
            variantType,
            variantName,
            enabled: Boolean(enabled),
            unitFee: Number(unitFee || 0),
          },
        }),
      );
    } catch {}
  };

  const getShipmentFeeDraftKey = (itemId, variantType = "product", variantName = "") =>
    [itemId || "item", variantType || "product", variantName || ""].join("__");

  const getShipmentFeeDraftValue = (currentFee, itemId, variantType = "product", variantName = "") => {
    const key = getShipmentFeeDraftKey(itemId, variantType, variantName);

    if (Object.prototype.hasOwnProperty.call(shipmentFeeDrafts, key)) {
      return shipmentFeeDrafts[key];
    }

    const fee = Number(currentFee || 0);

    return fee > 0 ? String(fee) : "";
  };

  const setShipmentFeeDraftValue = (itemId, variantType, variantName, value) => {
    const key = getShipmentFeeDraftKey(itemId, variantType, variantName);

    setShipmentFeeDrafts((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const clearShipmentFeeDraftValue = (itemId, variantType = "product", variantName = "") => {
    const key = getShipmentFeeDraftKey(itemId, variantType, variantName);

    setShipmentFeeDrafts((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const getCartShipmentQuantity = (cartItem) =>
    Math.max(1, Number(cartItem?.quantity ?? cartItem?.qty ?? cartItem?.count ?? 1) || 1);

  const getStoredCartShipmentUnitFee = (cartItem) => {
    const candidates = [
      cartItem?.storedShipmentFee,
      cartItem?.unitShipmentFee,
      cartItem?.shipmentFeePerUnit,
      cartItem?.shippingFeePerUnit,
      cartItem?.shipmentFee,
      cartItem?.shippingFee,
      cartItem?.deliveryFee,
    ];

    const positive = candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);

    return positive !== undefined ? Number(positive) : 0;
  };

  const calculateEnabledShipmentTotal = (cart = []) =>
    (Array.isArray(cart) ? cart : []).reduce((sum, cartItem) => {
      const enabled = Boolean(cartItem?.shipmentFeeEnabled ?? cartItem?.shipmentReady);

      if (!enabled) return sum;

      const quantity = getCartShipmentQuantity(cartItem);

      const unitFee = getStoredCartShipmentUnitFee(cartItem);

      return sum + unitFee * quantity;
    }, 0);

  // Read accumulated shipment receipts, never the original purchase payment.
  const getVerifiedShipmentPaidAmount = (order = {}) => {
    const shipment = order.shipmentPayment || {};
    const payment = shipment.payment || {};
    const amount = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
    const inflows = [payment.inflow, order.paymentAudit?.shipment?.inflow];
    if (String(order.paymentAudit?.lastKnownMode || "").toLowerCase() === "shipment") {
      inflows.push(order.paymentAudit?.lastKnownInflow);
    }
    const inflowPaid = Math.max(
      0,
      ...inflows
        .filter(Boolean)
        .map((entry) =>
          amount(
            entry.paidTotal ??
              entry.amountNormalized ??
              entry.amountPaid ??
              entry["amount paid"] ??
              entry.amount,
          ),
        ),
    );
    const states = [shipment.state, shipment.status, payment.state, payment.status].map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    );
    const confirmed =
      inflowPaid > 0 ||
      payment.paidAt ||
      payment.verifiedAt ||
      states.some((state) =>
        ["paid", "partial", "partially_paid", "success", "successful", "completed"].includes(state),
      );
    return confirmed ? Math.max(inflowPaid, amount(shipment.amountPaid), amount(payment.amountPaid)) : 0;
  };

  const buildShipmentPaymentPatch = (order, nextCart) => {
    const total = calculateEnabledShipmentTotal(nextCart);
    const paid = getVerifiedShipmentPaidAmount(order);
    const outstanding = Math.max(0, total - paid);
    const enabled = total > 0;
    const state = !enabled ? "not enabled" : paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid";
    return {
      "shipmentPayment.enabled": enabled,
      "shipmentPayment.state": state,
      "shipmentPayment.amount": total,
      "shipmentPayment.payableTotal": total,
      "shipmentPayment.amountPaid": paid,
      "shipmentPayment.outstanding": outstanding,
      "shipmentPayment.updatedAt": serverTimestamp(),
      "shipmentPayment.updatedBy": currentUser?.uid || null,
      "shipmentPayment.payment.state": state,
      "shipmentPayment.payment.amountPaid": paid,
      "shipmentPayment.payment.outstanding": outstanding,
      // Keep issued account amounts, references, inflows and payment history intact.
    };
  };

  const getCartShipmentConfig = (product, cartItem) => {
    const type = cartItem?.shipmentVariant?.type || cartItem?.lastVariantSelection || null;
    return getSelectedVariantShipmentConfig(
      product,
      getCartItemVariantName(cartItem, "color"),
      getCartItemVariantName(cartItem, "size"),
      type,
    );
  };

  const applyShipmentConfigToCartItem = (order, cartItem, config, changeReadiness = true) => {
    const previousEnabled = Boolean(cartItem.shipmentFeeEnabled ?? cartItem.shipmentReady);
    const paid = getVerifiedShipmentPaidAmount(order);
    const enabled = changeReadiness ? Boolean(config.enabled) : previousEnabled;
    // An off switch must not erase fees participating in an already paid receipt.
    if (!enabled && previousEnabled && paid > 0) return cartItem;
    const unitFee = Number(config.fee || 0);
    const total = unitFee * getCartShipmentQuantity(cartItem);
    const oldStatus = String(cartItem.shipmentStatus || "").toLowerCase();
    const finalStatus = ["paid", "shipped", "delivered", "completed"].includes(oldStatus);
    return {
      ...cartItem,
      shipmentFeeEnabled: enabled,
      shipmentReady: enabled,
      storedShipmentFee: unitFee,
      unitShipmentFee: unitFee,
      shipmentFeePerUnit: unitFee,
      shipmentFee: unitFee,
      storedShipmentTotal: total,
      shipmentTotal: enabled ? total : 0,
      totalShipmentFee: enabled ? total : 0,
      shipmentStatus: finalStatus ? cartItem.shipmentStatus : enabled ? "ready" : "not_ready",
      shipmentVariant: { type: config.type, name: config.name || "" },
      shipmentFeeUpdatedAt: new Date(),
      shipmentUpdatedAt: new Date(),
    };
  };

  // Discover every FOLANGE user/order, including those outside Context's page.
  // Admin rules must permit reads of folange/main/users and their orders.
  // Do not use a project-wide orders collection-group query here.
  const synchronizeProductShipmentOrders = async (product, scope = null) => {
    if (!isAdmin) throw new Error("Only an admin can update shipment fees.");
    const references = new Map();
    const matches = (cartItem) => {
      if (!cartItemMatchesProduct(cartItem, product)) return false;
      if (!scope) return true;
      const config = getCartShipmentConfig(product, cartItem);
      return (
        config.type === scope.type &&
        (scope.type === "product" ||
          normalizeProductIdentity(config.name) === normalizeProductIdentity(scope.name))
      );
    };
    for (const order of Array.isArray(orders) ? orders : []) {
      if (!Array.isArray(order.cart) || !order.cart.some(matches)) continue;
      const reference = getOrderDocumentReference(order);
      if (reference) references.set(reference.path, reference);
    }
    let discoveryError = null;
    try {
      let userCursor = null;
      while (true) {
        const userConstraints = [orderBy(documentId()), limit(200)];
        if (userCursor) userConstraints.push(startAfter(userCursor));
        const userPage = await getDocs(
          query(collection(db, ...folangeCollectionPath("users")), ...userConstraints),
        );
        for (const userSnapshot of userPage.docs) {
          let orderCursor = null;
          while (true) {
            const orderConstraints = [orderBy(documentId()), limit(200)];
            if (orderCursor) orderConstraints.push(startAfter(orderCursor));
            const orderPage = await getDocs(
              query(collection(db, ...folangeUserOrdersPath(userSnapshot.id)), ...orderConstraints),
            );
            for (const snapshot of orderPage.docs) {
              const order = snapshot.data();
              if (
                isFolangeOrderPath(snapshot.ref.path) &&
                Array.isArray(order.cart) &&
                order.cart.some(matches)
              ) {
                references.set(snapshot.ref.path, snapshot.ref);
              }
            }
            if (orderPage.size < 200) break;
            orderCursor = orderPage.docs[orderPage.docs.length - 1];
          }
        }
        if (userPage.size < 200) break;
        userCursor = userPage.docs[userPage.docs.length - 1];
      }
    } catch (error) {
      discoveryError = error;
      console.error("Could not discover every saved order:", error);
    }
    let updatedOrders = 0;
    let skippedOrders = 0;
    for (const reference of references.values()) {
      try {
        const updated = await runTransaction(db, async (transaction) => {
          // Re-read BOTH documents on retries so newer admin/payment writes survive.
          const productSnapshot = await transaction.get(doc(db, ...folangeProductPath(product.id)));
          const snapshot = await transaction.get(reference);
          if (!snapshot.exists() || !productSnapshot.exists()) return false;
          const latestProduct = { ...productSnapshot.data(), id: productSnapshot.id };
          const order = snapshot.data();
          if (!Array.isArray(order.cart)) return false;
          let changed = false;
          const nextCart = order.cart.map((cartItem) => {
            if (!cartItemMatchesProduct(cartItem, latestProduct)) return cartItem;
            const config = getCartShipmentConfig(latestProduct, cartItem);
            if (
              scope &&
              (config.type !== scope.type ||
                (scope.type !== "product" &&
                  normalizeProductIdentity(config.name) !== normalizeProductIdentity(scope.name)))
            )
              return cartItem;
            const nextItem = applyShipmentConfigToCartItem(order, cartItem, config);
            if (nextItem !== cartItem) changed = true;
            return nextItem;
          });
          if (!changed) return false;
          transaction.update(reference, {
            cart: nextCart,
            shipmentItemsUpdatedAt: serverTimestamp(),
            shipmentItemsUpdatedBy: currentUser?.uid || null,
            ...buildShipmentPaymentPatch(order, nextCart),
          });
          return true;
        });
        if (updated) updatedOrders += 1;
      } catch (error) {
        skippedOrders += 1;
        console.error("Could not synchronize shipment for order:", reference.path, error);
      }
    }
    return { updatedOrders, skippedOrders, discoveryError };
  };

  const reportShipmentSync = ({ updatedOrders, skippedOrders, discoveryError }) => {
    if (discoveryError) {
      toast.warn(
        `Product saved; ${updatedOrders} loaded order(s) updated. Some saved orders could not be checked. Please try saving again or contact support.`,
        { autoClose: false },
      );
    } else if (skippedOrders) {
      toast.warn(
        `Product saved; ${updatedOrders} order(s) updated, ${skippedOrders} failed. Save again to retry.`,
        { autoClose: false },
      );
    } else {
      toast.success(`Shipment saved. ${updatedOrders} existing order(s) synchronized.`);
    }
  };

  // Saving and switching use the same fresh-document transaction for products
  // and variants. A typed fee is saved together with Turn On/Off.
  // Keep the admin switch independent of order-discovery permissions.
  // Product/variant settings are committed first; existing orders are then
  // synchronized on a best-effort basis without rolling back the switch.
  const persistShipmentChange = async (item, variantType = "product", variantName = "", toggle = false) => {
    if (!isAdmin || !item?.id) return;
    if (shipmentUpdateBusy.current) {
      toast.info("A shipment update is already in progress.");
      return;
    }

    shipmentUpdateBusy.current = true;
    const suffix = variantType === "product" ? item.id : `${item.id}-${variantType}-${variantName}`;
    setLoadingItemId(`${toggle ? "shipment" : "shipment-fee-save"}-${suffix}`);
    const key = getShipmentFeeDraftKey(item.id, variantType, variantName);
    const draft = shipmentFeeDrafts[key];
    let saved;

    try {
      saved = await runTransaction(db, async (transaction) => {
        const reference = doc(db, ...folangeProductPath(item.id));
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This product no longer exists.");

        const product = { ...snapshot.data(), id: snapshot.id };
        const variant =
          variantType === "product" ? product : getVariantObject(product, variantType, variantName);
        if (!variant) throw new Error("This variant no longer exists. Reopen the product.");

        const config = typeof variant === "string" ? { name: variant } : variant;
        const wasEnabled = Boolean(config.shipmentFeeEnabled ?? config.shipmentReady);
        const enabled = toggle ? !wasEnabled : wasEnabled;
        const rawFee = draft === undefined ? (config.shipmentFee ?? config.storedShipmentFee ?? 0) : draft;
        const fee = Number(rawFee);

        // Switching OFF never requires a fee. Switching ON requires a saved
        // positive fee, and an unsaved typed fee is saved in the same action.
        if (
          (enabled && (!Number.isFinite(fee) || fee <= 0)) ||
          (!enabled && draft !== undefined && (!Number.isFinite(fee) || fee < 0))
        ) {
          throw new Error("Enter a valid shipment fee greater than zero before turning shipment on.");
        }
        const safeFee = Number.isFinite(fee) && fee >= 0 ? fee : 0;
        const fields = {
          shipmentFee: safeFee,
          storedShipmentFee: safeFee,
          shipmentFeeEnabled: enabled,
          shipmentReady: enabled,
        };
        const patch = {
          shipmentFeeUpdatedAt: serverTimestamp(),
          shipmentFeeUpdatedBy: currentUser?.uid || null,
        };

        if (variantType === "product") {
          Object.assign(patch, fields);
        } else {
          const collectionName = variantType === "color" ? "colors" : "sizes";
          patch[collectionName] = (product[collectionName] || []).map((entry) =>
            normalizeProductIdentity(getName(entry)) === normalizeProductIdentity(variantName)
              ? { ...(typeof entry === "string" ? { name: entry } : entry), ...fields }
              : entry,
          );
        }
        transaction.update(reference, patch);
        return { product: { ...product, ...patch }, enabled, fee: safeFee };
      });
    } catch (error) {
      console.error("Admin shipment switch could not be saved:", error);
      toast.error(
        error?.code === "permission-denied"
          ? "Firestore denied the product update. Check admin write permissions for cookingitems."
          : error?.message || "Could not save shipment setting.",
      );
      return;
    } finally {
      // This finally runs after the product write, regardless of whether
      // the optional order synchronization later succeeds.
      shipmentUpdateBusy.current = false;
      setLoadingItemId(null);
    }

    // Reflect the committed state immediately, even if collection-group
    // reads or individual historic-order writes are not permitted.
    setSelectedItem((previous) => (previous?.id === item.id ? saved.product : previous));
    setNewCookingItem((previous) =>
      previous?.id === item.id
        ? {
            ...previous,
            ...(variantType === "product"
              ? {
                  shipmentFee: saved.fee,
                  shipmentFeeEnabled: saved.enabled,
                  shipmentReady: saved.enabled,
                }
              : {
                  [variantType === "color" ? "colors" : "sizes"]:
                    saved.product[variantType === "color" ? "colors" : "sizes"],
                }),
          }
        : previous,
    );
    clearShipmentFeeDraftValue(item.id, variantType, variantName);
    emitShipmentSync({
      productId: item.id,
      variantType,
      variantName,
      enabled: saved.enabled,
      unitFee: saved.fee,
    });
    toast.success(
      toggle ? `Shipment fee payment turned ${saved.enabled ? "ON" : "OFF"}.` : "Shipment fee saved.",
    );

    // Order synchronization is deliberately separate: lack of permission to
    // list other customers' orders must never cause the toggle to fail.
    try {
      const result = await synchronizeProductShipmentOrders(saved.product, {
        type: variantType,
        name: variantName,
      });
      if (result.discoveryError || result.skippedOrders) {
        console.warn("Shipment settings saved, but some orders were not synchronized:", result);
        toast.warn(
          `Shipment setting saved. ${result.updatedOrders} order(s) updated; ` +
            `${result.skippedOrders} order(s) failed.` +
            (result.discoveryError
              ? " Full order lookup was denied; check admin collection-group read rules."
              : ""),
          { autoClose: false },
        );
      }
    } catch (error) {
      console.error("Shipment saved; order sync unavailable:", error);
      toast.warn(
        "Shipment setting saved, but existing orders could not be synchronized. Check order permissions.",
      );
    }
  };

  const saveProductShipmentFee = (item) => persistShipmentChange(item);
  const saveVariantShipmentFee = (item, type, name) => persistShipmentChange(item, type, name);
  const toggleProductShipmentFee = (item) => persistShipmentChange(item, "product", "", true);
  const toggleVariantShipmentFee = (item, type, name) => persistShipmentChange(item, type, name, true);

  const toggleVisibility = async (item) => {
    try {
      const nextAvailable = !item.available;

      await updateDoc(doc(db, ...folangeProductPath(item.id)), {
        available: nextAvailable,
      });

      setSelectedItem((prev) => (prev ? { ...prev, available: nextAvailable } : prev));

      toast.info(`Product is now ${nextAvailable ? "visible" : "hidden"} to visitors`);
    } catch (err) {
      toast.error("Failed to toggle visibility");
    }
  };

  // ---------- Add to Cart ----------
  const handleAddToCart = async (item, color = null, size = null, quantity = 1) => {
    setLoadingItemId(item.id);

    try {
      const hasVariantsFlag =
        (Array.isArray(item?.colors) && item.colors.length > 0) ||
        (Array.isArray(item?.sizes) && item.sizes.length > 0);

      const parentId = item.parentId || item.id;
      const parentItem = (baseCookingItems || []).find((i) => i.id === parentId);

      const parentQty = parentItem && !hasVariantsFlag ? Number(computeTotalStock(parentItem)) || 0 : null;

      const isPreOrder = normalize(item.status || "") === "preorder";

      if (parentQty !== null && parentQty <= 0 && !isPreOrder) {
        toast.error("This item is out of stock and cannot be added to cart.");
        return false;
      }

      const chosenColor = hasVariantsFlag
        ? typeof color === "string"
          ? color
          : getName(color) || null
        : null;

      const chosenSize = hasVariantsFlag ? (typeof size === "string" ? size : getName(size) || null) : null;

      if (hasVariantsFlag) {
        const availableQty = getVariantQuantity(item, chosenColor, chosenSize, lastVariantSelection);

        if (availableQty < Number(quantity || 1) && !isPreOrder) {
          toast.error("Requested quantity exceeds available stock for this variant.");
          return false;
        }
      }

      const variantImage = hasVariantsFlag
        ? getImageForVariant(item, chosenColor, chosenSize, lastVariantSelection)
        : item.image;

      const variantId = hasVariantsFlag
        ? [item.id, chosenColor, chosenSize].filter(Boolean).join("-")
        : item.id;

      const resolvedPrice = hasVariantsFlag
        ? getVariantPrice(item, chosenColor, chosenSize, lastVariantSelection)
        : (Number(item.priceDiscounted) ?? Number(item.priceOriginal) ?? null);

      if (resolvedPrice === null) {
        toast.error("Price could not be resolved for this item.");
        return false;
      }

      const variants =
        hasVariantsFlag && (chosenColor || chosenSize)
          ? {
              ...(chosenColor ? { color: chosenColor } : {}),
              ...(chosenSize ? { size: chosenSize } : {}),
            }
          : null;

      const variantText =
        variants && Object.keys(variants).length
          ? Object.entries(variants)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")
          : "";

      const selectedShipmentConfig = getSelectedVariantShipmentConfig(
        item,
        chosenColor,
        chosenSize,
        lastVariantSelection,
      );

      const selectedQuantity = Number(quantity) || 1;

      /*
        Always snapshot the configured fee in the cart.
        The readiness switch controls whether it is included
        in the shipment receipt, not whether the fee is stored.
      */
      const shipmentUnitFee = Number(selectedShipmentConfig.fee || 0);

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
        quantity: selectedQuantity,
        addedAt: Date.now(),
        status: item.status || "Available",
        variantPrice: resolvedPrice,
        price: resolvedPrice,

        /*
          Shipment is snapshotted for the exact selected
          colour or size. Other variants remain independent.
        */
        shipmentFeeEnabled: Boolean(selectedShipmentConfig.enabled),
        shipmentReady: Boolean(selectedShipmentConfig.enabled),
        storedShipmentFee: shipmentUnitFee,
        unitShipmentFee: shipmentUnitFee,
        shipmentFeePerUnit: shipmentUnitFee,
        shipmentFee: shipmentUnitFee,
        storedShipmentTotal: shipmentUnitFee * selectedQuantity,
        shipmentTotal: selectedShipmentConfig.enabled ? shipmentUnitFee * selectedQuantity : 0,
        totalShipmentFee: selectedShipmentConfig.enabled ? shipmentUnitFee * selectedQuantity : 0,
        shipmentStatus: selectedShipmentConfig.enabled ? "ready" : "not_ready",
        shipmentVariant: {
          type: selectedShipmentConfig.type,
          name: selectedShipmentConfig.name,
        },
      };

      addToCart(itemWithVariant, resolvedPrice);

      toast.success(
        `✅ ${item.name} added to cart${
          hasVariantsFlag ? ` (${quantity} × ${chosenColor || ""} ${chosenSize || ""})` : ` (${quantity})`
        }`,
      );

      return true;
    } catch (err) {
      toast.error("Something went wrong while adding to cart");
      return false;
    } finally {
      setLoadingItemId(null);
    }
  };

  const handleGridAddClick = (e, item) => {
    e.stopPropagation();

    if (hasVariants(item)) {
      openDetail(item);
      return;
    }

    handleAddToCart(item, null, null, 1);
  };

  // ---------- Share ----------
  const shareItem = async (item) => {
    const itemUrl = `${window.location.origin}/item/${encodeURIComponent(item.id)}`;

    const title = item?.name ? capitalizeWords(item.name) : "Product";
    const text = item?.description
      ? String(item.description).slice(0, 140)
      : "Discover this beauty product at Folange Beauty Lounge";

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: itemUrl });
        return;
      }

      await navigator.clipboard.writeText(itemUrl);
      toast.info("Link copied to clipboard!");
    } catch (e) {
      try {
        await navigator.clipboard.writeText(itemUrl);
        toast.info("Link copied to clipboard!");
      } catch {
        toast.error("Unable to share. Please copy the link manually.");
      }
    }
  };

  // ---------- Wishlist ----------
  const handleWish = async (item) => {
    // guest wishlist (local)
    if (!currentUser?.uid) {
      setLocalWishlist((prev) => {
        const exists = prev.includes(item.id);
        const next = exists ? prev.filter((x) => x !== item.id) : [...prev, item.id];
        toast.success(exists ? "Removed from wishlist!" : "Added to wishlist!");
        return next;
      });
      return;
    }

    try {
      const userId = currentUser.uid;
      const itemRef = doc(db, ...folangeProductPath(item.id));

      const alreadyWished = (item.wishedBy || []).includes(userId);

      await updateDoc(itemRef, {
        wishedBy: alreadyWished ? arrayRemove(userId) : arrayUnion(userId),
        wishes: increment(alreadyWished ? -1 : 1),
      });

      // Optimistic UI update (no read)
      if (selectedItem?.id === item.id) {
        setSelectedItem((prev) => {
          if (!prev) return prev;

          const prevWishedBy = Array.isArray(prev.wishedBy) ? prev.wishedBy : [];
          const nextWishedBy = alreadyWished
            ? prevWishedBy.filter((x) => x !== userId)
            : [...prevWishedBy, userId];

          const nextWishes = Math.max(0, Number(prev.wishes || 0) + (alreadyWished ? -1 : 1));

          return { ...prev, wishedBy: nextWishedBy, wishes: nextWishes };
        });
      }

      toast.success(alreadyWished ? "Removed from wishlist!" : "Added to wishlist!");
    } catch (err) {
      toast.error("Failed to update wishlist");
    }
  };

  // ---------- Tooltip ----------
  useEffect(() => {
    const intervals = [];
    const itemsForTooltip = (baseCookingItems || []).slice(0, 24);
    itemsForTooltip.forEach((item) => {
      const startDelay = Math.random() * 5000;
      const loop = () => {
        setTooltipVisible((prev) => ({ ...prev, [item.id]: true }));
        setTimeout(() => setTooltipVisible((prev) => ({ ...prev, [item.id]: false })), 2500);
        const nextDelay = 15000 + Math.random() * 5000;
        intervals.push(setTimeout(loop, nextDelay));
      };
      intervals.push(setTimeout(loop, startDelay));
    });
    return () => intervals.forEach((i) => clearTimeout(i));
  }, [baseCookingItems]);

  // ---------- Filtering ----------
  const itemsToDisplay = useMemo(() => {
    return normalize(statusFilter) === "wishlist"
      ? (baseCookingItems || []).filter((item) => {
          const signedInWish = currentUser?.uid && (item.wishedBy || []).includes(currentUser.uid);
          const guestWish = localWishlist.includes(item.id);
          return signedInWish || guestWish;
        })
      : baseFilteredCookingItems && baseFilteredCookingItems.length > 0
        ? baseFilteredCookingItems
        : statusFilter
          ? (baseCookingItems || []).filter((item) => normalize(item.status) === normalize(statusFilter))
          : baseCookingItems || [];
  }, [statusFilter, baseCookingItems, baseFilteredCookingItems, currentUser, localWishlist]);

  const visibleItems = useMemo(() => itemsToDisplay.slice(0, visibleCount), [itemsToDisplay, visibleCount]);

  const openEditModal = (item) => {
    if (!isAdmin) return;
    setEditingCookingItem(item);
    setNewCookingItem({
      ...item,
      image: item.image || null,
      trackingStage: item.trackingStage || "Pending",
      quantity: item.quantity ?? 0,
      restockAmount: 0,
      colorImages: item.colorImages || {},
      sizeImages: item.sizeImages || {},
    });
    setAddModalCustomVisible(false);
    setShowAddModal(true);
  };

  const openDetail = (item) => {
    if (!isAdmin && item?.available === false) {
      toast.info("This product is currently hidden.");
      return;
    }

    setSavedScroll(window.scrollY);
    setSelectedItem(item);
    setActiveColor(getName(item.colors?.[0]) || null);
    setActiveSize(null);
    setCustomTrackingInput(item.trackingStage || "");
    setSelectedQty(1);
    setLastVariantSelection(null);
    setShowAddedModalItemId(null);
  };

  const updateSelectedItemTracking = async (newStage) => {
    if (!selectedItem) return;

    if ((selectedItem.trackingStage || "") === newStage) return;

    try {
      await updateDoc(doc(db, ...folangeProductPath(selectedItem.id)), {
        trackingStage: newStage,
      });
      setSelectedItem((prev) => ({ ...prev, trackingStage: newStage }));
      toast.success(`Tracking stage updated to "${newStage}"`);
    } catch (err) {
      toast.error("Failed to update tracking stage");
    }
  };

  // ---------- Render ----------
  return (
    <div
      id="store"
      className="folange-store scroll-mt-48 bg-[#FFFCF7] px-4 py-8 text-[#3F3528] sm:px-6 lg:px-8"
      aria-labelledby="folange-store-title"
    >
      <span id="cookingitems" aria-hidden="true" className="block h-0" />
      <style>{`
        .folange-store input:not([type="checkbox"]):not([type="file"]),
        .folange-store select,
        .folange-store textarea {
          border-color: #e5d6b5;
        }
        .folange-store input:focus-visible,
        .folange-store select:focus-visible,
        .folange-store textarea:focus-visible,
        .folange-store button:focus-visible,
        .folange-store a:focus-visible {
          outline: 2px solid #9a7428;
          outline-offset: 3px;
        }
        .folange-store .folange-gold-button,
        .folange-store .folange-outline-button,
        .folange-store .folange-danger-button {
          border: 1px solid #d4af37;
          border-radius: 0.65rem;
          font-weight: 600;
          transition: background-color 150ms, border-color 150ms, color 150ms;
        }
        .folange-store .folange-gold-button {
          background-color: #d4af37;
          color: #3f3528;
        }
        .folange-store .folange-gold-button:hover:not(:disabled) {
          background-color: #e7c65c;
          border-color: #e7c65c;
        }
        .folange-store .folange-outline-button {
          background-color: #fffcf7;
          border-color: #e5d6b5;
          color: #3f3528;
        }
        .folange-store .folange-outline-button:hover:not(:disabled),
        .folange-store .folange-toggle-button[aria-pressed="true"] {
          background-color: #f8f0de;
          border-color: #d4af37;
          color: #8a6517;
        }
        .folange-store .folange-danger-button {
          background-color: #fffcf7;
          border-color: #dfb6b5;
          color: #974342;
        }
        .folange-store .folange-danger-button:hover:not(:disabled) {
          background-color: #f9ece9;
          border-color: #bf7770;
        }
        .folange-store .folange-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.3rem;
          padding: 0.4rem;
          border: 1px solid #e5d6b5;
          border-radius: 999px;
          background-color: #fffcf7;
          color: #8a6517;
        }
        .folange-store .folange-icon-button:hover:not(:disabled),
        .folange-store .folange-wishlist-button[aria-pressed="true"] {
          background-color: #f8f0de;
          border-color: #d4af37;
          color: #8a6517;
        }
        .folange-store .folange-wishlist-button[aria-pressed="false"] svg {
          color: #b3a489;
        }
        .folange-store .folange-swatch-button {
          border-color: #e5d6b5;
        }
        .folange-store .folange-swatch-button[aria-pressed="true"] {
          border-color: #9a7428;
          box-shadow: 0 0 0 2px #f8f0de;
        }
        .folange-store .folange-gold-button:disabled,
        .folange-store .folange-outline-button:disabled,
        .folange-store .folange-danger-button:disabled {
          background-color: #e8dfce;
          border-color: #d1c6af;
          color: #625849;
          cursor: not-allowed;
        }
        .folange-store input[type="checkbox"] {
          accent-color: #9a7428;
        }
        .folange-store input[type="file"]::file-selector-button {
          margin-right: 0.5rem;
          padding: 0.4rem 0.6rem;
          border: 1px solid #e5d6b5;
          border-radius: 0.5rem;
          background-color: #f8f0de;
          color: #3f3528;
          cursor: pointer;
        }
      `}</style>
      <div className="mb-6 border-b border-[#E7D8B8] pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-[#8A6517]">
          Folange Beauty Lounge
        </p>
        <h2
          id="folange-store-title"
          className="text-3xl text-[#3F3528] sm:text-4xl"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          Beauty Store
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#7D7262]">
          Explore cosmetics, skincare, body care, hair care and beauty essentials.
        </p>
        <span className="mt-4 inline-flex items-center rounded-full border border-[#E6D5A9] bg-[#F8F0DE] px-4 py-2 text-sm font-medium text-[#8A6517]">
          {getCategoryIcon(filterCategory)}
          {filterCategory || "All Beauty Products"}
        </span>
      </div>

      {/* Temporary: any signed-in Folange user can add a product */}
      {Boolean(currentUser?.uid) && (
        <div className="mb-6">
          <button
            onClick={() => {
              setEditingCookingItem(null);
              setNewCookingItem({
                name: "",
                description: "",
                priceOriginal: "",
                priceDiscounted: "",
                shipmentFee: "",
                shipmentFeeEnabled: false,
                image: null,
                category: "",
                sizes: [],
                colors: [],
                colorImages: {},
                sizeImages: {},
                available: true,
                status: "Available",
                trackingStage: "Pending",
                wishes: 0,
                wishedBy: [],
                quantity: 0,
                restockAmount: 0,
              });
              setColorFiles({});
              setSizeFiles({});
              setAddModalCustomVisible(false);
              setShowAddModal(true);
            }}
            className="folange-gold-button px-4 py-2 rounded-md"
            type="button"
          >
            Add Beauty Product
          </button>
        </div>
      )}

      {/* Product grid */}
      {itemsToDisplay.length === 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {(baseCookingItems || []).slice(0, visibleCount).map((item) => {
              const stockTotal = computeTotalStock(item);
              const itemHasVariants = hasVariants(item);

              const isWished =
                (currentUser?.uid && (item.wishedBy || []).includes(currentUser.uid)) ||
                localWishlist.includes(item.id);

              return (
                <div
                  key={item.id}
                  className="relative overflow-hidden rounded-2xl border border-[#E9DDBF] bg-white shadow-sm transition-shadow hover:shadow-md cursor-pointer"
                  onClick={() => openDetail(item)}
                >
                  <span
                    className={`absolute top-2 left-2 px-2 py-1 text-xs rounded text-white ${
                      normalize(item.status) === "available" ? "bg-green-600" : "bg-yellow-600"
                    }`}
                  >
                    {item.status}
                  </span>

                  <div className="absolute top-2 right-2 px-2 py-1 text-xs rounded text-white bg-gray-800">
                    {`Stock: ${stockTotal}`}
                  </div>

                  <div className="absolute top-10 right-2 flex flex-col gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWish(item);
                      }}
                      className="folange-icon-button folange-wishlist-button text-xl transition-colors duration-200"
                      type="button"
                      aria-pressed={Boolean(isWished)}
                      aria-label={isWished ? "Remove product from wishlist" : "Add product to wishlist"}
                    >
                      <FaHeart /> {item.wishes || 0}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        shareItem(item);
                      }}
                      className="folange-icon-button text-xl transition-colors duration-200"
                      type="button"
                      aria-label="Share product"
                    >
                      <FaShareAlt />
                    </button>
                  </div>

                  <img
                    src={getImageForColor(item, getName(item.colors?.[0]) || item.colors?.[0])}
                    alt={item.name}
                    className="w-full h-48 object-contain rounded-t-2xl bg-[#FFFEFA] p-3 sm:h-56"
                  />

                  <div className="p-2 flex flex-col gap-2">
                    <p className="text-center font-bold text-gray-800">{capitalizeWords(item.name)}</p>
                    <p className="text-center text-gray-700 font-semibold">
                      ₦{Number(item.priceDiscounted ?? item.priceOriginal ?? 0).toLocaleString()}
                    </p>

                    <button
                      onClick={(e) => handleGridAddClick(e, item)}
                      disabled={loadingItemId === item.id}
                      className="folange-gold-button px-3 py-1 rounded"
                      type="button"
                    >
                      {loadingItemId === item.id
                        ? "Adding..."
                        : itemHasVariants
                          ? "Select Options"
                          : "Add to Cart"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleCount < (baseCookingItems?.length || 0) && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => setVisibleCount((prev) => prev + 6)}
                className="folange-gold-button px-6 py-2 rounded-md transition-colors"
                type="button"
              >
                Load More
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {(visibleItems || []).map((item) => {
              const stockTotal = computeTotalStock(item);
              const itemHasVariants = hasVariants(item);

              const isWished =
                (currentUser?.uid && (item.wishedBy || []).includes(currentUser.uid)) ||
                localWishlist.includes(item.id);

              return (
                <div
                  key={item.id}
                  className="relative overflow-hidden rounded-2xl border border-[#E9DDBF] bg-white shadow-sm transition-shadow hover:shadow-md cursor-pointer"
                  onClick={() => openDetail(item)}
                >
                  <span
                    className={`absolute top-2 left-2 px-2 py-1 text-xs rounded text-white ${
                      normalize(item.status) === "available" ? "bg-green-600" : "bg-yellow-600"
                    }`}
                  >
                    {item.status}
                  </span>

                  <div className="absolute top-2 right-2 px-2 py-1 text-xs rounded text-white bg-gray-800">
                    {`Stock: ${stockTotal}`}
                  </div>

                  <div className="absolute top-10 right-2 flex flex-col gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleWish(item);
                      }}
                      className="folange-icon-button folange-wishlist-button text-xl transition-colors duration-200"
                      type="button"
                      aria-pressed={Boolean(isWished)}
                      aria-label={isWished ? "Remove product from wishlist" : "Add product to wishlist"}
                    >
                      <FaHeart /> {item.wishes || 0}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        shareItem(item);
                      }}
                      className="folange-icon-button text-xl transition-colors duration-200"
                      type="button"
                      aria-label="Share product"
                    >
                      <FaShareAlt />
                    </button>
                  </div>

                  <img
                    src={getImageForColor(item, getName(item.colors?.[0]) || item.colors?.[0])}
                    alt={item.name}
                    className="w-full h-48 object-contain rounded-t-2xl bg-[#FFFEFA] p-3 sm:h-56"
                  />

                  <div className="p-2 flex flex-col gap-2">
                    <p className="text-center font-bold text-gray-800">{capitalizeWords(item.name)}</p>
                    <p className="text-center text-gray-700 font-semibold">
                      ₦{Number(item.priceDiscounted ?? item.priceOriginal ?? 0).toLocaleString()}
                    </p>

                    <button
                      onClick={(e) => handleGridAddClick(e, item)}
                      disabled={loadingItemId === item.id}
                      className="folange-gold-button px-3 py-1 rounded"
                      type="button"
                    >
                      {loadingItemId === item.id
                        ? "Adding..."
                        : itemHasVariants
                          ? "Select Options"
                          : "Add to Cart"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleCount < itemsToDisplay.length && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => setVisibleCount((prev) => prev + 6)}
                className="folange-gold-button px-6 py-2 rounded-md transition-colors"
                type="button"
              >
                Load More
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={(e) => e.target === e.currentTarget && setSelectedItem(null)}
        >
          <div
            className="bg-[#FFFCF7] p-6 rounded-2xl border border-[#E7D8B8] max-w-lg w-full relative shadow-xl overflow-y-auto max-h-[90vh] pb-[80px]"
            role="dialog"
            aria-modal="true"
          >
            <button
              onClick={() => {
                setSelectedItem(null);
                setShowAddedModalItemId(null);
                setLastVariantSelection(null);
              }}
              className="folange-icon-button absolute top-3 right-3"
              type="button"
              aria-label="Close product details"
            >
              ✕
            </button>

            <h2 className="text-2xl font-bold mb-2 text-center">{capitalizeWords(selectedItem.name)}</h2>

            <AnimatePresence mode="wait">
              <motion.img
                key={`${selectedItem.id}-${activeColor || "noc"}-${activeSize || "nos"}`}
                src={getImageForVariant(
                  selectedItem,
                  activeColor || getName(selectedItem.colors?.[0]) || null,
                  activeSize || null,
                  lastVariantSelection,
                )}
                alt={selectedItem.name}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
                className="w-full h-64 object-contain rounded-xl bg-[#FFFEFA] p-3 mb-4"
              />
            </AnimatePresence>

            {/* Circular color swatches */}
            {Array.isArray(selectedItem.colors) && selectedItem.colors.length > 0 && (
              <div className="mb-3">
                <p className="text-sm font-semibold">Pick a shade:</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedItem.colors.map((color, idx) => {
                    const name = getName(color) || `color-${idx}`;
                    const colorImg = selectedItem.colorImages?.[name];
                    return (
                      <button
                        key={name}
                        onClick={() => {
                          setActiveColor(name);
                          setLastVariantSelection("color");
                          const newStock = getVariantQuantity(selectedItem, name, activeSize, "color");
                          setSelectedQty((q) => clampQtyToStock(q, newStock));
                        }}
                        title={name}
                        className={`folange-swatch-button w-8 h-8 rounded-full border-2 flex items-center justify-center overflow-hidden transition-transform ${activeColor === name ? "scale-110" : ""}`}
                        style={{ padding: 0 }}
                        type="button"
                        aria-pressed={activeColor === name}
                        aria-label={`Select shade ${name}`}
                      >
                        {colorImg ? (
                          <img src={colorImg} alt={name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="w-full h-full block" style={{ backgroundColor: name }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="mb-4 text-gray-700 leading-relaxed">{selectedItem.description}</p>

            {/* Combined dropdown row */}
            <div className="mb-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.isArray(selectedItem.colors) && selectedItem.colors.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Colours / Shades:</p>
                    <select
                      value={activeColor || ""}
                      onChange={(e) => {
                        const nextColor = e.target.value || null;
                        setActiveColor(nextColor);
                        setLastVariantSelection("color");
                        const newStock = getVariantQuantity(selectedItem, nextColor, activeSize, "color");
                        setSelectedQty((q) => clampQtyToStock(q, newStock));
                      }}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">Select colour / shade</option>
                      {selectedItem.colors.map((color, idx) => {
                        const name = getName(color) || `color-${idx}`;
                        const price =
                          color?.priceDiscounted ?? color?.priceOriginal ?? selectedItem.priceDiscounted;
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

                {Array.isArray(selectedItem?.sizes) && selectedItem.sizes.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-2">Sizes / Volumes:</p>

                    <select
                      value={activeSize || ""}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        setActiveSize(value);
                        setLastVariantSelection("size");
                        const newStock = getVariantQuantity(selectedItem, activeColor, value, "size");
                        setSelectedQty((q) => clampQtyToStock(q, newStock));
                      }}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="">Select size / volume</option>

                      {selectedItem.sizes.map((size, idx) => {
                        const name = getName(size) || `size-${idx}`;
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
              </div>
            </div>

            <p className="mb-2 text-sm italic text-gray-600">Category: {selectedItem.category}</p>

            <p className="mb-2 text-sm font-semibold">
              Status:{" "}
              <span
                className={`px-2 py-1 text-xs rounded text-white ${
                  normalize(selectedItem.status) === "available" ? "bg-green-600" : "bg-yellow-600"
                }`}
              >
                {selectedItem.status}
              </span>
            </p>

            <p className="mb-2 text-sm font-semibold">
              Stock:{" "}
              <span className="px-2 py-1 text-xs rounded bg-gray-800 text-white">
                {getVariantQuantity(selectedItem, activeColor, activeSize, lastVariantSelection)}
              </span>
            </p>

            <p className="mb-2 text-sm font-semibold">
              Tracking Stage:{" "}
              <span
                className={`px-2 py-1 text-xs rounded text-white ${
                  (selectedItem.trackingStage || "").toLowerCase().includes("deliv")
                    ? "bg-green-600"
                    : (selectedItem.trackingStage || "").toLowerCase().includes("ship")
                      ? "bg-blue-600"
                      : "bg-gray-500"
                }`}
              >
                {selectedItem.trackingStage || "Pending"}
              </span>
            </p>

            <p className="mt-2 text-sm text-gray-600">
              {normalize(selectedItem.status) === "available"
                ? "✅ This item is in stock and ready for delivery."
                : "Please contact Folange for the current availability and delivery estimate."}
            </p>

            {/* Variant price display */}
            <p className="mb-2 text-gray-400 line-through">
              Original: ₦{selectedItem.priceOriginal?.toLocaleString()}
            </p>
            <p className="font-semibold text-[#8A6517] text-lg mb-2">
              Discount: ₦
              {(
                getVariantPrice(selectedItem, activeColor, activeSize, lastVariantSelection) ??
                selectedItem.priceDiscounted
              )?.toLocaleString()}
            </p>

            {!hasVariants(selectedItem) && Number(selectedItem.shipmentFee || 0) > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-sm text-gray-700">
                  🚚 Shipment Fee: ₦{Number(selectedItem.shipmentFee || 0).toLocaleString()}
                </p>

                <p
                  className={`mt-1 text-xs font-semibold ${
                    selectedItem.shipmentFeeEnabled ? "text-green-700" : "text-amber-700"
                  }`}
                >
                  {selectedItem.shipmentFeeEnabled
                    ? "Ready for delivery — shipment payment is enabled for this item."
                    : "Not ready for delivery — shipment payment is currently disabled for this item."}
                </p>
              </div>
            )}

            {/* Qty picker */}
            <div className="mt-3 flex items-center gap-3">
              <p className="text-sm font-semibold">Quantity:</p>

              <button
                type="button"
                className="folange-outline-button px-3 py-1 border rounded"
                onClick={() => setSelectedQty((q) => Math.max(1, Number(q || 1) - 1))}
                aria-label="Decrease quantity"
              >
                -
              </button>

              <input
                type="number"
                min="1"
                value={selectedQty}
                onChange={(e) => {
                  const stock = getSelectedItemCurrentStock(selectedItem);
                  const next = clampQtyToStock(e.target.value, stock);
                  setSelectedQty(next);
                  if (Number(e.target.value) > stock) {
                    toast.info(`Only ${stock} left in stock for this selection.`);
                  }
                }}
                className="w-20 border px-2 py-1 rounded text-center"
              />

              <button
                type="button"
                className="folange-outline-button px-3 py-1 border rounded"
                onClick={() => {
                  const stock = getSelectedItemCurrentStock(selectedItem);
                  setSelectedQty((q) => {
                    const next = Number(q || 1) + 1;
                    if (next > stock) {
                      toast.info(`Only ${stock} left in stock for this selection.`);
                      return stock > 0 ? stock : 1;
                    }
                    return next;
                  });
                }}
                aria-label="Increase quantity"
              >
                +
              </button>

              <span className="text-xs text-gray-500 ml-auto">
                Max: {getSelectedItemCurrentStock(selectedItem)}
              </span>
            </div>

            <div className="flex flex-col gap-3 mt-6">
              {showAddedModalItemId === selectedItem.id ? (
                <div className="flex flex-col sm:flex-row gap-3 mt-6">
                  <button
                    onClick={() => {
                      setSelectedItem(null);
                      setShowAddedModalItemId(null);
                      toggleCart();
                    }}
                    className="folange-gold-button flex-1 px-4 py-2 rounded"
                    type="button"
                  >
                    Go to Cart 🛒
                  </button>

                  <button
                    onClick={() => {
                      setShowAddedModalItemId(null);
                      setSelectedItem(null);
                      setLastVariantSelection(null);
                      setTimeout(() => {
                        window.scrollTo({
                          top: savedScroll,
                          behavior: "smooth",
                        });
                      }, 300);
                    }}
                    className="folange-outline-button flex-1 px-4 py-2 rounded"
                    type="button"
                  >
                    Continue Shopping
                  </button>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    const chosenColor =
                      activeColor || (selectedItem.colors?.length ? getName(selectedItem.colors[0]) : null);
                    const chosenSize =
                      activeSize || (selectedItem.sizes?.length ? getName(selectedItem.sizes[0]) : null);

                    const ok = await handleAddToCart(selectedItem, chosenColor, chosenSize, selectedQty || 1);

                    if (ok) setShowAddedModalItemId(selectedItem.id);
                  }}
                  disabled={loadingItemId === selectedItem.id}
                  className="folange-gold-button px-4 py-2 rounded"
                  type="button"
                >
                  {loadingItemId === selectedItem.id ? "Adding..." : `Add ${selectedQty} to Cart`}
                </button>
              )}
            </div>

            <div className="mt-6 border-t pt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => handleWish(selectedItem)}
                  className="folange-outline-button folange-wishlist-button flex-1 flex items-center justify-center gap-2 border rounded-md py-2 text-sm font-semibold transition-colors"
                  type="button"
                  aria-pressed={Boolean(
                    (currentUser?.uid && (selectedItem.wishedBy || []).includes(currentUser.uid)) ||
                    localWishlist.includes(selectedItem.id),
                  )}
                >
                  <FaHeart className="text-lg" />
                  Wishlist
                </button>

                <button
                  onClick={() => shareItem(selectedItem)}
                  className="folange-outline-button flex-1 flex items-center justify-center gap-2 border rounded-md py-2 text-sm font-semibold transition-colors"
                  type="button"
                  aria-label="Share product"
                >
                  <FaShareAlt className="text-lg" />
                  Share
                </button>
              </div>

              <div className="flex justify-center gap-5 text-xl mt-2">
                <a href="#" className="text-blue-600 hover:scale-110 transition">
                  <FaFacebook />
                </a>
                <a href="#" className="text-green-500 hover:scale-110 transition">
                  <FaWhatsapp />
                </a>
                <a href="#" className="text-sky-500 hover:scale-110 transition">
                  <FaTwitter />
                </a>
                <a href="#" className="text-pink-500 hover:scale-110 transition">
                  <FaInstagram />
                </a>
              </div>

              <button
                className="folange-outline-button w-full py-2 rounded-md font-semibold border-b-2 transition-colors"
                type="button"
              >
                Reviews (0)
              </button>
            </div>

            {/* Admin Controls */}
            {isAdmin && (
              <div className="mt-6 border-t pt-4 space-y-3">
                <h3 className="font-semibold text-gray-700 mb-2">Admin Controls</h3>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => {
                      setEditingCookingItem(selectedItem);
                      setNewCookingItem({
                        ...selectedItem,
                        image: selectedItem.image || null,
                        trackingStage: selectedItem.trackingStage || "Pending",
                        quantity: selectedItem.quantity ?? 0,
                        restockAmount: 0,
                        colorImages: selectedItem.colorImages || {},
                        sizeImages: selectedItem.sizeImages || {},
                        shipmentFeeEnabled: Boolean(selectedItem.shipmentFeeEnabled),
                      });
                      setColorFiles({});
                      setSizeFiles({});
                      setAddModalCustomVisible(false);
                      setShowAddModal(true);
                    }}
                    className="folange-gold-button flex-1 px-4 py-2 rounded transition"
                    type="button"
                  >
                    Edit Product
                  </button>

                  <button
                    onClick={() => toggleVisibility(selectedItem)}
                    className="folange-outline-button folange-toggle-button flex-1 px-4 py-2 rounded transition"
                    type="button"
                    aria-pressed={Boolean(selectedItem.available)}
                  >
                    {selectedItem.available ? "Hide Product" : "Show Product"}
                  </button>

                  <button
                    onClick={() => confirmDeleteToast(selectedItem)}
                    className="folange-danger-button flex-1 px-4 py-2 rounded transition"
                    type="button"
                  >
                    Delete Product
                  </button>
                </div>

                {!hasVariants(selectedItem) && (
                  <div className="rounded-lg border border-[#E6D5A9] bg-[#F8F0DE] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-gray-800">Individual Shipment Payment</p>

                        <p className="mt-1 text-xs leading-5 text-gray-600">
                          Turn this on only when this particular product is ready for delivery. Existing
                          orders containing this product will be updated independently without enabling
                          shipment payment for other products in the same order.
                        </p>

                        <div className="mt-3">
                          <label className="mb-1 block text-xs font-semibold text-gray-700">
                            Shipment fee for this product
                          </label>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500">
                                ₦
                              </span>

                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={getShipmentFeeDraftValue(
                                  selectedItem.shipmentFee,
                                  selectedItem.id,
                                  "product",
                                  "",
                                )}
                                onChange={(event) =>
                                  setShipmentFeeDraftValue(selectedItem.id, "product", "", event.target.value)
                                }
                                disabled={loadingItemId === `shipment-fee-save-${selectedItem.id}`}
                                placeholder="Enter shipment fee"
                                className="w-full rounded border border-[#E6D5A9] bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-[#D4AF37]"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => saveProductShipmentFee(selectedItem)}
                              disabled={loadingItemId === `shipment-fee-save-${selectedItem.id}`}
                              className="folange-gold-button rounded px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed"
                            >
                              {loadingItemId === `shipment-fee-save-${selectedItem.id}`
                                ? "Saving..."
                                : "Save Fee"}
                            </button>
                          </div>

                          <p className="mt-1 text-[11px] leading-4 text-gray-500">
                            This exact saved amount is synchronized to matching existing orders and is the
                            unit fee the receipt will use. The receipt multiplies it by the quantity ordered.
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleProductShipmentFee(selectedItem)}
                        disabled={loadingItemId === `shipment-${selectedItem.id}`}
                        className="folange-outline-button folange-toggle-button min-w-[180px] rounded-lg px-4 py-3 text-sm font-semibold transition"
                        aria-pressed={Boolean(selectedItem.shipmentFeeEnabled)}
                      >
                        {loadingItemId === `shipment-${selectedItem.id}`
                          ? "Updating Orders..."
                          : selectedItem.shipmentFeeEnabled
                            ? "Turn Shipment Fee Off"
                            : "Turn Shipment Fee On"}
                      </button>
                    </div>

                    <div className="mt-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                          selectedItem.shipmentFeeEnabled
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {selectedItem.shipmentFeeEnabled
                          ? "READY — CUSTOMER CAN PAY"
                          : "NOT READY — PAYMENT DISABLED"}
                      </span>
                    </div>
                  </div>
                )}

                {Array.isArray(selectedItem.colors) && selectedItem.colors.length > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <h4 className="font-bold text-gray-800">Colour Shipment Controls</h4>

                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Each colour can be managed independently. As soon as a colour is turned on, its saved
                      unit shipment fee is synchronized to matching orders and shipment payment becomes
                      available for those order items immediately.
                    </p>

                    <div className="mt-3 space-y-3">
                      {selectedItem.colors.map((color) => {
                        const colorName = getName(color);

                        const loadingKey = `shipment-${selectedItem.id}-color-${colorName}`;

                        return (
                          <div
                            key={colorName}
                            className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="font-semibold text-gray-800">{colorName}</p>

                              <div className="mt-2">
                                <label className="mb-1 block text-[11px] font-semibold text-gray-600">
                                  Shipment fee
                                </label>

                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <div className="relative flex-1">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500">
                                      ₦
                                    </span>

                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={getShipmentFeeDraftValue(
                                        color?.shipmentFee,
                                        selectedItem.id,
                                        "color",
                                        colorName,
                                      )}
                                      onChange={(event) =>
                                        setShipmentFeeDraftValue(
                                          selectedItem.id,
                                          "color",
                                          colorName,
                                          event.target.value,
                                        )
                                      }
                                      disabled={
                                        loadingItemId ===
                                        `shipment-fee-save-${selectedItem.id}-color-${colorName}`
                                      }
                                      placeholder="Enter fee"
                                      className="w-full rounded border px-7 py-2 text-xs outline-none focus:border-[#D4AF37]"
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => saveVariantShipmentFee(selectedItem, "color", colorName)}
                                    disabled={
                                      loadingItemId ===
                                      `shipment-fee-save-${selectedItem.id}-color-${colorName}`
                                    }
                                    className="folange-gold-button rounded px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed"
                                  >
                                    {loadingItemId ===
                                    `shipment-fee-save-${selectedItem.id}-color-${colorName}`
                                      ? "Saving..."
                                      : "Save Fee"}
                                  </button>
                                </div>

                                <p className="mt-1 text-[10px] text-gray-500">
                                  Save Fee corrects the stored amount for this colour and matching orders.
                                  Turn On makes that amount payable immediately.
                                </p>
                              </div>

                              <span
                                className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${
                                  color?.shipmentFeeEnabled
                                    ? "bg-green-100 text-green-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {color?.shipmentFeeEnabled ? "READY" : "NOT READY"}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleVariantShipmentFee(selectedItem, "color", colorName)}
                              disabled={loadingItemId === loadingKey}
                              className="folange-outline-button folange-toggle-button rounded-lg px-4 py-2 text-sm font-semibold"
                              aria-pressed={Boolean(color?.shipmentFeeEnabled)}
                            >
                              {loadingItemId === loadingKey
                                ? "Updating..."
                                : color?.shipmentFeeEnabled
                                  ? "Turn Off"
                                  : "Turn On & Enable Payment"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {Array.isArray(selectedItem.sizes) && selectedItem.sizes.length > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <h4 className="font-bold text-gray-800">Size Shipment Controls</h4>

                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Each size can be managed independently. As soon as a size is turned on, its saved unit
                      shipment fee is synchronized to matching orders and shipment payment becomes available
                      for those order items immediately.
                    </p>

                    <div className="mt-3 space-y-3">
                      {selectedItem.sizes.map((size) => {
                        const sizeName = getName(size);

                        const loadingKey = `shipment-${selectedItem.id}-size-${sizeName}`;

                        return (
                          <div
                            key={sizeName}
                            className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="font-semibold text-gray-800">{sizeName}</p>

                              <div className="mt-2">
                                <label className="mb-1 block text-[11px] font-semibold text-gray-600">
                                  Shipment fee
                                </label>

                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <div className="relative flex-1">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500">
                                      ₦
                                    </span>

                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={getShipmentFeeDraftValue(
                                        size?.shipmentFee,
                                        selectedItem.id,
                                        "size",
                                        sizeName,
                                      )}
                                      onChange={(event) =>
                                        setShipmentFeeDraftValue(
                                          selectedItem.id,
                                          "size",
                                          sizeName,
                                          event.target.value,
                                        )
                                      }
                                      disabled={
                                        loadingItemId ===
                                        `shipment-fee-save-${selectedItem.id}-size-${sizeName}`
                                      }
                                      placeholder="Enter fee"
                                      className="w-full rounded border px-7 py-2 text-xs outline-none focus:border-[#D4AF37]"
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => saveVariantShipmentFee(selectedItem, "size", sizeName)}
                                    disabled={
                                      loadingItemId ===
                                      `shipment-fee-save-${selectedItem.id}-size-${sizeName}`
                                    }
                                    className="folange-gold-button rounded px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed"
                                  >
                                    {loadingItemId === `shipment-fee-save-${selectedItem.id}-size-${sizeName}`
                                      ? "Saving..."
                                      : "Save Fee"}
                                  </button>
                                </div>

                                <p className="mt-1 text-[10px] text-gray-500">
                                  Save Fee corrects the stored amount for this size and matching orders. Turn
                                  On makes that amount payable immediately.
                                </p>
                              </div>

                              <span
                                className={`mt-1 inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${
                                  size?.shipmentFeeEnabled
                                    ? "bg-green-100 text-green-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {size?.shipmentFeeEnabled ? "READY" : "NOT READY"}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleVariantShipmentFee(selectedItem, "size", sizeName)}
                              disabled={loadingItemId === loadingKey}
                              className="folange-outline-button folange-toggle-button rounded-lg px-4 py-2 text-sm font-semibold"
                              aria-pressed={Boolean(size?.shipmentFeeEnabled)}
                            >
                              {loadingItemId === loadingKey
                                ? "Updating..."
                                : size?.shipmentFeeEnabled
                                  ? "Turn Off"
                                  : "Turn On & Enable Payment"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quick Tracking Stage */}
                <div className="mt-3">
                  <label className="text-sm font-semibold mb-2 block">Quick Tracking Stage</label>
                  <div className="flex gap-2 items-center">
                    <select
                      value={selectedItem.trackingStage || "Pending"}
                      onChange={async (e) => {
                        const val = e.target.value;
                        if (val === "Custom") {
                          setCustomTrackingInput("");
                          setSelectedItem((prev) => ({
                            ...prev,
                            trackingStage: "Custom",
                          }));
                          return;
                        }
                        await updateSelectedItemTracking(val);
                      }}
                      className="border px-3 py-2 rounded"
                    >
                      <option value="Pending">Pending</option>
                      <option value="Processing">Processing</option>
                      <option value="Packed">Packed</option>
                      <option value="Shipped (ReadyForDelivery)">Shipped (ReadyForDelivery)</option>
                      <option value="Out for Delivery">Out for Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Custom">Custom</option>
                    </select>

                    {(selectedItem.trackingStage === "Custom" || selectedItem.trackingStage === "Custom") && (
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Enter custom tracking stage"
                          value={customTrackingInput}
                          onChange={(e) => setCustomTrackingInput(e.target.value)}
                          className="border px-3 py-2 rounded"
                        />
                        <button
                          onClick={async () => {
                            if (!customTrackingInput || !customTrackingInput.trim()) {
                              toast.error("Please provide a custom tracking stage");
                              return;
                            }
                            await updateSelectedItemTracking(customTrackingInput.trim());
                            setCustomTrackingInput("");
                          }}
                          className="folange-gold-button px-3 py-2 rounded"
                          type="button"
                        >
                          Save Tracking
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && Boolean(currentUser?.uid) && (isAdmin || !editingCookingItem) && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4"
          onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}
        >
          <div className="bg-[#FFFCF7] p-6 rounded-2xl border border-[#E7D8B8] shadow-md w-full max-w-md overflow-y-auto max-h-[90vh]">
            <h3 className="text-xl font-bold mb-4 text-gray-800">
              {editingCookingItem ? "Edit Beauty Product" : "Add Beauty Product"}
            </h3>

            {(() => {
              const hasVariantsLocal =
                (newCookingItem.colors?.length || 0) > 0 || (newCookingItem.sizes?.length || 0) > 0;

              return (
                <>
                  <input
                    name="name"
                    type="text"
                    placeholder="Product name (e.g. Hydrating Face Serum)"
                    value={newCookingItem.name}
                    onChange={handleInputChange}
                    className="w-full mb-2 border px-3 py-2 rounded"
                  />

                  <textarea
                    name="description"
                    placeholder="Describe the product, ingredients, benefits and directions for use"
                    value={newCookingItem.description}
                    onChange={handleInputChange}
                    className="w-full mb-2 border px-3 py-2 rounded"
                  />

                  {!hasVariantsLocal && (
                    <>
                      <input
                        name="priceOriginal"
                        type="number"
                        placeholder="Original Price (₦)"
                        value={newCookingItem.priceOriginal}
                        onChange={handleInputChange}
                        className="w-full mb-2 border px-3 py-2 rounded"
                      />

                      <input
                        name="priceDiscounted"
                        type="number"
                        placeholder="Discounted Price (₦)"
                        value={newCookingItem.priceDiscounted}
                        onChange={handleInputChange}
                        className="w-full mb-2 border px-3 py-2 rounded"
                      />
                    </>
                  )}

                  {!hasVariantsLocal && (
                    <div className="mb-3 rounded-lg border border-[#E6D5A9] bg-[#F8F0DE] p-3">
                      <label className="mb-1 block text-sm font-semibold text-gray-800">
                        Product Shipment Fee
                      </label>

                      <input
                        name="shipmentFee"
                        type="number"
                        min="0"
                        placeholder="Shipment Fee (₦ - paid separately)"
                        value={newCookingItem.shipmentFee}
                        onChange={handleInputChange}
                        className="w-full border px-3 py-2 rounded"
                      />

                      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          name="shipmentFeeEnabled"
                          checked={!!newCookingItem.shipmentFeeEnabled}
                          onChange={handleInputChange}
                          className="mt-1 accent-[#D4AF37]"
                        />

                        <span>
                          This product is ready for delivery. Allow customers to pay shipment for this product
                          only.
                        </span>
                      </label>

                      <p className="mt-2 text-xs leading-5 text-gray-500">
                        Leave this unchecked until the item is ready. Other items in the same order will
                        remain disabled until you turn their shipment fee on separately.
                      </p>
                    </div>
                  )}

                  <div className="mb-2">
                    <input name="image" type="file" onChange={handleInputChange} className="mb-2 w-full" />
                    {editingCookingItem?.image && typeof editingCookingItem.image === "string" && (
                      <img
                        src={editingCookingItem.image}
                        alt="preview"
                        className="w-28 h-28 object-cover rounded"
                      />
                    )}
                  </div>

                  <select
                    name="category"
                    value={newCookingItem.category}
                    onChange={handleInputChange}
                    className="w-full mb-2 border px-3 py-2 rounded"
                  >
                    <option value="">Select Beauty Category</option>
                    {newCookingItem.category && !categories.includes(newCookingItem.category) && (
                      <option value={newCookingItem.category}>{newCookingItem.category}</option>
                    )}
                    {(categories || []).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  {/* COLORS */}
                  <div className="mb-3">
                    <label className="block text-sm font-semibold mb-1">Colours / Shades</label>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={colorInput}
                        onChange={(e) => setColorInput(e.target.value)}
                        placeholder="Add shade (e.g. Warm Nude or #B76E79)"
                        className="flex-grow border px-3 py-2 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => addArrayValue("colors", colorInput)}
                        className="folange-gold-button px-3 py-2 rounded"
                        aria-label="Add colour or shade variant"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      {(newCookingItem.colors || []).map((c) => {
                        const cname = getName(c);
                        return (
                          <div
                            key={cname}
                            className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E7D8B8] bg-[#FFFEFA] p-3"
                          >
                            <span className="px-2 py-1 bg-gray-200 rounded w-20">{cname}</span>

                            <input
                              type="number"
                              placeholder="Original ₦"
                              value={c.priceOriginal}
                              onChange={(e) =>
                                setNewCookingItem((prev) => ({
                                  ...prev,
                                  colors: prev.colors.map((col) =>
                                    getName(col) === cname ? { ...col, priceOriginal: e.target.value } : col,
                                  ),
                                }))
                              }
                              className="border px-2 py-1 w-24 rounded"
                            />

                            <input
                              type="number"
                              placeholder="Discount ₦"
                              value={c.priceDiscounted}
                              onChange={(e) =>
                                setNewCookingItem((prev) => ({
                                  ...prev,
                                  colors: prev.colors.map((col) =>
                                    getName(col) === cname
                                      ? {
                                          ...col,
                                          priceDiscounted: e.target.value,
                                        }
                                      : col,
                                  ),
                                }))
                              }
                              className="border px-2 py-1 w-24 rounded"
                            />

                            <input
                              type="number"
                              min="0"
                              placeholder="Shipment ₦"
                              value={c.shipmentFee || ""}
                              onChange={(e) =>
                                setNewCookingItem((prev) => ({
                                  ...prev,
                                  colors: prev.colors.map((col) =>
                                    getName(col) === cname
                                      ? {
                                          ...col,
                                          shipmentFee: e.target.value,
                                        }
                                      : col,
                                  ),
                                }))
                              }
                              className="border px-2 py-1 w-28 rounded"
                            />

                            <label className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                              <input
                                type="checkbox"
                                checked={!!c.shipmentFeeEnabled}
                                onChange={(e) =>
                                  setNewCookingItem((prev) => ({
                                    ...prev,
                                    colors: prev.colors.map((col) =>
                                      getName(col) === cname
                                        ? {
                                            ...col,
                                            shipmentFeeEnabled: e.target.checked,
                                            shipmentReady: e.target.checked,
                                          }
                                        : col,
                                    ),
                                  }))
                                }
                                className="accent-[#D4AF37]"
                              />
                              Ready
                            </label>

                            <input
                              type="number"
                              min="0"
                              placeholder="Qty"
                              value={c.quantity}
                              readOnly
                              onFocus={handleQtyEditAttempt}
                              className="border px-2 py-1 w-20 rounded bg-gray-50 cursor-not-allowed"
                              title="To change variant stock go to Inventory → Restock this variant"
                            />

                            <input
                              name={`color-file-${cname}`}
                              type="file"
                              onChange={handleInputChange}
                              className="w-24"
                            />

                            {(() => {
                              const previewUrl = colorPreviewUrls?.[cname];
                              const savedUrl = newCookingItem.colorImages?.[cname];
                              const shown = previewUrl || savedUrl || null;

                              return shown ? (
                                <img
                                  src={shown}
                                  alt={`${cname} preview`}
                                  className="w-10 h-10 object-cover rounded border"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded border bg-gray-50 flex items-center justify-center text-[10px] text-gray-400">
                                  no img
                                </div>
                              );
                            })()}

                            <button
                              type="button"
                              onClick={() => removeArrayValue("colors", cname)}
                              className="folange-danger-button px-2 py-1 rounded"
                              aria-label={`Remove shade ${cname}`}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* SIZES */}
                  <div className="mb-3">
                    <label className="block text-sm font-semibold mb-1">Sizes / Volumes</label>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={sizeInput}
                        onChange={(e) => setSizeInput(e.target.value)}
                        placeholder="Add size / volume (e.g. 50 ml, 100 ml, 250 g)"
                        className="flex-grow border px-3 py-2 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => addArrayValue("sizes", sizeInput)}
                        className="folange-gold-button px-3 py-2 rounded"
                        aria-label="Add size or volume variant"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      {(newCookingItem.sizes || []).map((s) => {
                        const sname = getName(s);
                        return (
                          <div
                            key={sname}
                            className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E7D8B8] bg-[#FFFEFA] p-3"
                          >
                            <span className="px-2 py-1 bg-gray-200 rounded w-20">{sname}</span>

                            <input
                              type="number"
                              placeholder="Original ₦"
                              value={s.priceOriginal}
                              onChange={(e) =>
                                setNewCookingItem((prev) => ({
                                  ...prev,
                                  sizes: prev.sizes.map((sz) =>
                                    getName(sz) === sname ? { ...sz, priceOriginal: e.target.value } : sz,
                                  ),
                                }))
                              }
                              className="border px-2 py-1 w-24 rounded"
                            />

                            <input
                              type="number"
                              placeholder="Discount ₦"
                              value={s.priceDiscounted}
                              onChange={(e) =>
                                setNewCookingItem((prev) => ({
                                  ...prev,
                                  sizes: prev.sizes.map((sz) =>
                                    getName(sz) === sname
                                      ? {
                                          ...sz,
                                          priceDiscounted: e.target.value,
                                        }
                                      : sz,
                                  ),
                                }))
                              }
                              className="border px-2 py-1 w-24 rounded"
                            />

                            <input
                              type="number"
                              min="0"
                              placeholder="Shipment ₦"
                              value={s.shipmentFee || ""}
                              onChange={(e) =>
                                setNewCookingItem((prev) => ({
                                  ...prev,
                                  sizes: prev.sizes.map((sz) =>
                                    getName(sz) === sname
                                      ? {
                                          ...sz,
                                          shipmentFee: e.target.value,
                                        }
                                      : sz,
                                  ),
                                }))
                              }
                              className="border px-2 py-1 w-28 rounded"
                            />

                            <label className="flex items-center gap-1 text-xs font-semibold text-gray-700">
                              <input
                                type="checkbox"
                                checked={!!s.shipmentFeeEnabled}
                                onChange={(e) =>
                                  setNewCookingItem((prev) => ({
                                    ...prev,
                                    sizes: prev.sizes.map((sz) =>
                                      getName(sz) === sname
                                        ? {
                                            ...sz,
                                            shipmentFeeEnabled: e.target.checked,
                                            shipmentReady: e.target.checked,
                                          }
                                        : sz,
                                    ),
                                  }))
                                }
                                className="accent-[#D4AF37]"
                              />
                              Ready
                            </label>

                            <input
                              type="number"
                              min="0"
                              placeholder="Qty"
                              value={s.quantity}
                              readOnly
                              onFocus={handleQtyEditAttempt}
                              className="border px-2 py-1 w-20 rounded bg-gray-50 cursor-not-allowed"
                              title="To change variant stock go to Inventory → Restock this variant"
                            />

                            <input
                              name={`size-file-${sname}`}
                              type="file"
                              onChange={handleInputChange}
                              className="w-24"
                            />

                            {(() => {
                              const previewUrl = sizePreviewUrls?.[sname];
                              const savedUrl = newCookingItem.sizeImages?.[sname];
                              const shown = previewUrl || savedUrl || null;

                              return shown ? (
                                <img
                                  src={shown}
                                  alt={`${sname} preview`}
                                  className="w-10 h-10 object-cover rounded border"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded border bg-gray-50 flex items-center justify-center text-[10px] text-gray-400">
                                  no img
                                </div>
                              );
                            })()}

                            <button
                              type="button"
                              onClick={() => removeArrayValue("sizes", sname)}
                              className="folange-danger-button px-2 py-1 rounded"
                              aria-label={`Remove size ${sname}`}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* AVAILABILITY */}
                  <div className="flex gap-2 items-center mb-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="available"
                        checked={!!newCookingItem.available}
                        onChange={handleInputChange}
                      />{" "}
                      Available
                    </label>

                    <select
                      name="status"
                      value={newCookingItem.status}
                      onChange={handleInputChange}
                      className="ml-auto border px-2 py-1 rounded"
                    >
                      <option value="Available">Available</option>
                      <option value="Pre-Order">Pre-Order</option>
                    </select>
                  </div>

                  {/* STOCK (ONLY IF NO VARIANTS) */}
                  {!hasVariantsLocal && !editingCookingItem && (
                    <div className="mb-3">
                      <label className="block text-sm font-semibold mb-1">Initial Stock Quantity</label>
                      <input
                        name="quantity"
                        type="number"
                        min="0"
                        value={newCookingItem.quantity}
                        readOnly
                        onFocus={handleQtyEditAttempt}
                        className="w-full border px-3 py-2 rounded bg-gray-50 cursor-not-allowed"
                        title="To change stock quantities please use Inventory → Restock"
                      />
                    </div>
                  )}

                  {!hasVariantsLocal && editingCookingItem && (
                    <div className="mb-3">
                      <label className="block text-sm font-semibold mb-1">Restock Amount</label>
                      <input
                        name="restockAmount"
                        type="number"
                        min="0"
                        value={newCookingItem.restockAmount}
                        onChange={handleInputChange}
                        className="w-full border px-3 py-2 rounded"
                      />
                    </div>
                  )}

                  {/* TRACKING */}
                  <div className="mb-3">
                    <label className="block text-sm font-semibold mb-1">Tracking Stage</label>
                    <select
                      name="trackingStage"
                      value={newCookingItem.trackingStage || "Pending"}
                      onChange={handleInputChange}
                      className="w-full border px-3 py-2 rounded"
                    >
                      <option value="Pending">Pending</option>
                      <option value="Processing">Processing</option>
                      <option value="Packed">Packed</option>
                      <option value="Shipped (ReadyForDelivery)">Shipped (ReadyForDelivery)</option>
                      <option value="Out for Delivery">Out for Delivery</option>
                      <option value="Delivered">Delivered</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </div>

                  {/* ACTIONS */}
                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      onClick={() => {
                        setShowAddModal(false);
                        setAddModalCustomVisible(false);
                      }}
                      className="folange-outline-button px-4 py-2 rounded"
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitCookingItem}
                      disabled={Boolean(loadingItemId?.startsWith("shipment"))}
                      className="folange-gold-button px-4 py-2 rounded"
                      type="button"
                    >
                      {loadingItemId === "shipment-product-form"
                        ? "Saving…"
                        : editingCookingItem
                          ? "Update"
                          : "Add"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
