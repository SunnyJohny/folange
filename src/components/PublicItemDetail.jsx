import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { toast } from "react-toastify";
import { useMyContext } from "../Context/MyContext";
import { FaShareAlt } from "react-icons/fa";

// ✅ helper
const normalize = (s) =>
  (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "");
const getName = (maybeObjOrString) =>
  typeof maybeObjOrString === "string"
    ? maybeObjOrString
    : maybeObjOrString?.name ?? null;

export default function PublicItemDetail() {
  const { id: routeId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { addToCart, toggleCart, capitalizeWords } = useMyContext();

  const bodyScrollRef = useRef(null);

  // ✅ supports:
  // 1) /item/:id
  // 2) /?item=ID
  const queryId = searchParams.get("item");
  const effectiveId = queryId || routeId;

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  const [activeColor, setActiveColor] = useState(null);
  const [activeSize, setActiveSize] = useState(null);
  const [lastVariantSelection, setLastVariantSelection] = useState(null);
  const [qty, setQty] = useState(1);

  // New: track add-to-cart progress so user sees toast reliably and button is disabled during add
  const [addingToCart, setAddingToCart] = useState(false);

  // New: local in-modal feedback (falls back when global toast is hidden by z-index)
  const [localMsg, setLocalMsg] = useState(null); // { type: 'success'|'error', text: string }
  const localMsgTimerRef = useRef(null);

  const closeModal = () => {
    if (searchParams.get("item")) {
      const next = new URLSearchParams(searchParams);
      next.delete("item");
      setSearchParams(next, { replace: true });
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };

  const hasVariants = (it) =>
    (Array.isArray(it?.colors) && it.colors.length > 0) ||
    (Array.isArray(it?.sizes) && it.sizes.length > 0);

  const getImageForColor = (it, colorName) => {
    const c = (colorName || "").toString().trim();
    return (
      (it?.colorImages && c ? it.colorImages[c] : null) ||
      it?.image ||
      "/placeholder.jpg"
    );
  };

  const toNum = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const getVariantPrice = (it, colorName, sizeName, lastSel = null) => {
    const basePrice =
      toNum(it?.priceDiscounted) ?? toNum(it?.priceOriginal) ?? 0;
    if (!hasVariants(it)) return basePrice;

    const sizeObj =
      sizeName && (it.sizes || []).find((s) => getName(s) === sizeName);
    const colorObj =
      colorName && (it.colors || []).find((c) => getName(c) === colorName);

    const sizePrice =
      sizeObj &&
      (toNum(sizeObj.priceDiscounted) ?? toNum(sizeObj.priceOriginal));
    const colorPrice =
      colorObj &&
      (toNum(colorObj.priceDiscounted) ?? toNum(colorObj.priceOriginal));

    if (lastSel === "size") return sizePrice ?? colorPrice ?? basePrice;
    if (lastSel === "color") return colorPrice ?? sizePrice ?? basePrice;
    return sizePrice ?? colorPrice ?? basePrice;
  };

  const clampQty = (q, stock) => {
    const qq = Number(q || 1);
    const ss = Number(stock || 0);
    if (!Number.isFinite(qq) || qq <= 0) return 1;
    if (!Number.isFinite(ss) || ss <= 0) return 1;
    return Math.min(qq, ss);
  };

  const scrollToBottom = () => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTo({
        top: bodyScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);

        if (!effectiveId) {
          if (mounted) {
            setItem(null);
            setLoading(false);
          }
          return;
        }

        const ref = doc(db, "cookingitems", String(effectiveId));
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          toast.error("Product not found");
          closeModal();
          return;
        }

        const data = { id: snap.id, ...snap.data() };

        if (data?.available === false) {
          toast.info("This product is currently hidden.");
          closeModal();
          return;
        }

        if (!mounted) return;

        setItem(data);

        const defaultColor = getName(data?.colors?.[0]) || null;
        setActiveColor(defaultColor);
        setActiveSize(null);
        setLastVariantSelection(null);
        setQty(1);
      } catch (e) {
        console.error(e);
        toast.error("Failed to load product");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [effectiveId]);

  // cleanup local message timer on unmount
  useEffect(() => {
    return () => {
      try {
        if (localMsgTimerRef.current) {
          clearTimeout(localMsgTimerRef.current);
          localMsgTimerRef.current = null;
        }
      } catch { }
    };
  }, []);

  const showLocalMessage = (text, type = "success", duration = 2500) => {
    try {
      if (localMsgTimerRef.current) {
        clearTimeout(localMsgTimerRef.current);
        localMsgTimerRef.current = null;
      }
    } catch { }
    setLocalMsg({ text: String(text || ""), type: type === "error" ? "error" : "success" });
    localMsgTimerRef.current = setTimeout(() => {
      setLocalMsg(null);
      localMsgTimerRef.current = null;
    }, duration);
  };

  const shareThis = async () => {
    const url = `${window.location.origin}/?item=${encodeURIComponent(
      String(effectiveId)
    )}`;

    const title = item?.name ? capitalizeWords(item.name) : "Product";
    const text = item?.description
      ? String(item.description).slice(0, 140)
      : "Check this product";

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.info("Link copied to clipboard!");
      showLocalMessage("Link copied to clipboard!", "success");
    } catch {
      toast.error("Unable to share");
      showLocalMessage("Unable to share", "error");
    }
  };

  const handleAddToCart = async () => {
    if (!item) return;

    // prevent double-clicks/duplicates while adding
    if (addingToCart) return;

    const itemHasVariants = hasVariants(item);

    const chosenColor = itemHasVariants
      ? activeColor || getName(item.colors?.[0]) || null
      : null;

    const chosenSize = itemHasVariants
      ? activeSize || (item.sizes?.length ? getName(item.sizes?.[0]) : null)
      : null;

    const resolvedPrice = itemHasVariants
      ? getVariantPrice(item, chosenColor, chosenSize, lastVariantSelection)
      : Number(item.priceDiscounted) ?? Number(item.priceOriginal) ?? 0;

    if (resolvedPrice === null || resolvedPrice === undefined) {
      toast.error("Price could not be resolved for this item.");
      showLocalMessage("Price could not be resolved", "error");
      return;
    }

    const variantId = itemHasVariants
      ? [item.id, chosenColor, chosenSize].filter(Boolean).join("-")
      : item.id;

    const colorImage =
      itemHasVariants && chosenColor && item.colorImages
        ? item.colorImages[chosenColor] || item.image
        : item.image;

    const variants =
      itemHasVariants && (chosenColor || chosenSize)
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

    const cartItem = {
      ...item,
      id: variantId,
      parentId: item.id,
      ...(chosenColor ? { selectedColor: chosenColor } : {}),
      ...(chosenSize ? { selectedSize: chosenSize } : {}),
      ...(variants ? { variants } : {}),
      variantText,
      variantImage: colorImage,
      image: colorImage,
      quantity: Math.max(1, Number(qty || 1)),
      addedAt: Date.now(),
      status: item.status || "Available",
      variantPrice: resolvedPrice,
      price: resolvedPrice,
    };

    try {
      setAddingToCart(true);

      // Support both sync and async implementations of addToCart
      // If addToCart returns a promise, await it; else it resolves immediately.
      await Promise.resolve(addToCart?.(cartItem, resolvedPrice));

      // show global toast (if visible) and local message fallback
      toast.success("Added to cart ✅");
      showLocalMessage("Added to cart ✅", "success");

      // open/toggle cart UI if available; do it after a short delay so toast is visible
      setTimeout(() => toggleCart?.(), 200);
    } catch (err) {
      console.error("addToCart failed:", err);
      const msg = err?.message || "Unable to add to cart";
      toast.error(msg);
      showLocalMessage(msg, "error");
    } finally {
      setAddingToCart(false);
    }
  };

  const pageTitle = item?.name ? capitalizeWords(item.name) : "Product";

  const displayedPrice = useMemo(() => {
    if (!item) return 0;
    return getVariantPrice(item, activeColor, activeSize, lastVariantSelection);
  }, [item, activeColor, activeSize, lastVariantSelection]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-start justify-center px-3 py-2 sm:px-4 sm:py-4">
        <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-xl overflow-hidden mt-2 sm:mt-4">
          <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
            <div className="animate-pulse h-6 bg-gray-200 rounded w-2/3" />
            <div className="animate-pulse h-10 bg-gray-200 rounded w-28" />
          </div>

          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="animate-pulse h-72 bg-gray-200 rounded mb-4" />
            <div className="animate-pulse h-4 bg-gray-200 rounded w-full mb-2" />
            <div className="animate-pulse h-4 bg-gray-200 rounded w-5/6 mb-2" />
            <div className="animate-pulse h-4 bg-gray-200 rounded w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-start justify-center px-3 py-2 sm:px-4 sm:py-4">
      <div className="absolute inset-0" onClick={closeModal} aria-hidden="true" />

      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-xl overflow-hidden mt-2 sm:mt-4">
        <div className="sticky top-0 z-20 bg-white border-b px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg sm:text-xl font-bold truncate">{pageTitle}</h1>

          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                shareThis();
              }}
              className="flex items-center gap-2 px-3 py-2 border rounded hover:text-green-700"
              type="button"
            >
              <FaShareAlt />
              Share
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
              }}
              className="px-3 py-2 border rounded hover:bg-gray-100"
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Local in-modal message (guaranteed visible above modal content) */}
        {localMsg ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10010,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                background: localMsg.type === "error" ? "#dc2626" : "#16a34a",
                color: "#fff",
                padding: "8px 14px",
                borderRadius: 8,
                fontWeight: 600,
                boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                pointerEvents: "auto",
              }}
            >
              {localMsg.text}
            </div>
          </div>
        ) : null}

        <div
          ref={bodyScrollRef}
          className="max-h-[88vh] overflow-y-auto scroll-smooth px-4 pt-4 pb-6"
        >
          <div className="mt-1">
            <img
              src={getImageForColor(
                item,
                activeColor || getName(item.colors?.[0]) || null
              )}
              alt={pageTitle}
              className="w-full h-72 object-cover rounded"
            />
          </div>

          <div className="mt-4 text-gray-700 leading-relaxed whitespace-pre-line">
            {item?.description || ""}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-1 rounded bg-gray-100">
              Category: {item?.category || "—"}
            </span>

            <span
              className={`px-2 py-1 rounded text-white ${normalize(item?.status) === "available"
                  ? "bg-green-600"
                  : "bg-yellow-600"
                }`}
            >
              Status: {item?.status || "—"}
            </span>

            {item?.trackingStage ? (
              <span className="px-2 py-1 rounded bg-gray-800 text-white">
                Tracking: {item.trackingStage}
              </span>
            ) : null}
          </div>

          <div className="mt-4">
            {item?.priceOriginal ? (
              <div className="text-gray-400 line-through">
                Original: ₦{Number(item.priceOriginal || 0).toLocaleString()}
              </div>
            ) : null}

            <div className="text-red-600 text-xl font-bold">
              ₦{Number(displayedPrice || 0).toLocaleString()}
            </div>

            {item?.shipmentFee ? (
              <div className="mt-1 text-sm text-gray-700">
                🚚 Shipment Fee: ₦{Number(item.shipmentFee || 0).toLocaleString()}{" "}
                <span className="italic text-gray-500">(paid separately)</span>
              </div>
            ) : null}
          </div>

          {Array.isArray(item?.colors) && item.colors.length > 0 ? (
            <div className="mt-5">
              <div className="text-sm font-semibold mb-2">Colors</div>

              <div className="flex flex-wrap gap-2">
                {item.colors.map((c, idx) => {
                  const name = getName(c) || `color-${idx}`;
                  const img = item?.colorImages?.[name] || null;
                  const active = activeColor === name;

                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setActiveColor(name);
                        setLastVariantSelection("color");
                      }}
                      className={`w-9 h-9 rounded-full border-2 overflow-hidden transition-transform ${active ? "border-black scale-110" : "border-gray-300"
                        }`}
                      title={name}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt={name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span
                          className="w-full h-full block"
                          style={{ backgroundColor: name }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2">
                <select
                  value={activeColor || ""}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setActiveColor(next);
                    setLastVariantSelection("color");
                  }}
                  className="w-full border px-3 py-2 rounded"
                >
                  <option value="">Select color</option>
                  {item.colors.map((c, idx) => {
                    const name = getName(c) || `color-${idx}`;
                    const price = c?.priceDiscounted ?? c?.priceOriginal ?? null;
                    const labelPrice = price
                      ? ` - ₦${Number(price).toLocaleString()}`
                      : "";
                    return (
                      <option key={name} value={name}>
                        {name}
                        {labelPrice}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          ) : null}

          {Array.isArray(item?.sizes) && item.sizes.length > 0 ? (
            <div className="mt-5">
              <div className="text-sm font-semibold mb-2">Sizes</div>

              <select
                value={activeSize || ""}
                onChange={(e) => {
                  const next = e.target.value || null;
                  setActiveSize(next);
                  setLastVariantSelection("size");
                }}
                className="w-full border px-3 py-2 rounded"
              >
                <option value="">Select size</option>
                {item.sizes.map((s, idx) => {
                  const name = getName(s) || `size-${idx}`;
                  const price = s?.priceDiscounted ?? s?.priceOriginal ?? null;
                  const labelPrice = price
                    ? ` - ₦${Number(price).toLocaleString()}`
                    : "";
                  return (
                    <option key={name} value={name}>
                      {name}
                      {labelPrice}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col sm:flex-row gap-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Qty:</span>

              <button
                type="button"
                className="px-3 py-2 border rounded"
                onClick={() => setQty((q) => Math.max(1, Number(q || 1) - 1))}
              >
                -
              </button>

              <input
                type="number"
                min="1"
                value={qty}
                onChange={(e) =>
                  setQty(Math.max(1, Number(e.target.value || 1)))
                }
                className="w-20 border px-2 py-2 rounded text-center"
              />

              <button
                type="button"
                className="px-3 py-2 border rounded"
                onClick={() => setQty((q) => Math.max(1, Number(q || 1) + 1))}
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={addingToCart}
              aria-busy={addingToCart}
              className={`w-full sm:w-auto flex-1 ${addingToCart ? "bg-gray-500" : "bg-red-600 hover:bg-red-700"
                } text-white px-4 py-3 rounded font-semibold`}
            >
              {addingToCart ? "Adding..." : "Add to Cart"}
            </button>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                closeModal();
                // navigate("/products");
              }}
              className="w-full border border-green-600 bg-green-600 text-white px-4 py-3 rounded font-medium hover:bg-green-700 transition-colors"
            >
              Continue Shopping
            </button>
          </div>

          <div className="h-12" />
        </div>
      </div>
    </div>
  );
}