import React, { useRef, useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendar, FaEdit, FaTrash } from "react-icons/fa";
import { useMyContext } from "../Context/MyContext"; // <-- your context
import { db } from "../firebase"; // your firebase config
import {
  doc,
  updateDoc,
  arrayUnion,
  increment,
  deleteDoc,
  runTransaction,
  getDoc,
} from "firebase/firestore";

import { toast } from "react-toastify";
import { v4 as uuidv4 } from "uuid";

const InventoryPage = () => {
  const navigate = useNavigate();
  const tableRef = useRef(null);
  const modalReturnPositionRef = useRef({
    windowY: 0,
    tableScrollTop: 0,
  });

  // Get cookingitems, orders & user from context
  const { cookingitems, currentUser, orders } = useMyContext();
  const isAdmin = currentUser?.role === "admin";

  // ------------------------------------------------------------
  // ✅ CHAREX PRODUCT PATH RESOLVER
  // Canonical product path:
  // charex/main/cookingitems/{productId}
  //
  // Fallbacks are retained so existing products saved under an older
  // path can still be restocked, edited, deleted, and synced.
  // ------------------------------------------------------------
  const getProductRefCandidates = (productId) => {
    const id = String(productId || "").trim();
    if (!id) return [];

    return [
      {
        label: "charex/main/cookingitems",
        ref: doc(db, "charex", "main", "cookingitems", id),
      },
      {
        label: "charex",
        ref: doc(db, "charex", id),
      },
      {
        label: "cookingitems",
        ref: doc(db, "cookingitems", id),
      },
    ];
  };

  const resolveExistingProductRef = async (productId, transaction = null) => {
    const candidates = getProductRefCandidates(productId);

    for (const candidate of candidates) {
      const snap = transaction
        ? await transaction.get(candidate.ref)
        : await getDoc(candidate.ref);

      if (snap.exists()) {
        return {
          ref: candidate.ref,
          snap,
          pathLabel: candidate.label,
        };
      }
    }

    return {
      ref: null,
      snap: null,
      pathLabel: null,
    };
  };

  const [searchKeyword, setSearchKeyword] = useState("");

  // ✅ NEW: Sales start date filter
  // This does NOT delete old sales. It only tells inventory calculations
  // to count soldHistory/orders from this date upward.
  const [salesStartDate, setSalesStartDate] = useState(() => {
    try {
      return localStorage.getItem("inventorySalesStartDate") || "2026-05-27";
    } catch (err) {
      return "2026-05-27";
    }
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [modalVariant, setModalVariant] = useState(null);

  const [editRestockOpen, setEditRestockOpen] = useState(false);
  const [editingRestock, setEditingRestock] = useState(null);
  const [addRestockOpen, setAddRestockOpen] = useState(false);
  const [newRestock, setNewRestock] = useState({
    quantity: "", // keep empty so input shows blank (not confusing 0)
    shipmentFee: "",
    variant: "", // color or size name
    variantType: "auto", // "auto" | "color" | "size" | "none"
    note: "",
    productId: null,
  });

  const [editSoldOpen, setEditSoldOpen] = useState(false);
  const [editingSold, setEditingSold] = useState(null);

  const [refreshIndex, setRefreshIndex] = useState(0); // lightweight refresh trigger for UI after edits

  // NEW: processing state for syncing orders -> inventory
  const [processingSync, setProcessingSync] = useState(false);
  const [syncProgress, setSyncProgress] = useState({
    total: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
  });

  useEffect(() => {
    try {
      if (salesStartDate) {
        localStorage.setItem("inventorySalesStartDate", salesStartDate);
      } else {
        localStorage.removeItem("inventorySalesStartDate");
      }
    } catch (err) {}
  }, [salesStartDate]);

  const handleReload = () => window.location.reload();
  const getCurrentDate = () => new Date().toLocaleDateString();

  /*
    ✅ Modal close/page-position fix
    Before opening any modal, we remember the current page/table scroll position.
    When closing a modal, we only close that modal and restore the previous position.
    This prevents the page from jumping back to the top card section.
  */
  const rememberCurrentPosition = () => {
    modalReturnPositionRef.current = {
      windowY: window.scrollY || window.pageYOffset || 0,
      tableScrollTop: tableRef.current?.scrollTop || 0,
    };
  };

  const restorePreviousPosition = () => {
    const saved = modalReturnPositionRef.current;

    window.requestAnimationFrame(() => {
      setTimeout(() => {
        if (tableRef.current) {
          tableRef.current.scrollTop = saved.tableScrollTop || 0;
        }

        window.scrollTo({
          top: saved.windowY || 0,
          left: 0,
          behavior: "auto",
        });
      }, 0);
    });
  };

  const closeMainModal = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setModalOpen(false);
    setModalItem(null);
    setModalVariant(null);
    setAddRestockOpen(false);
    setNewRestock({
      quantity: "",
      shipmentFee: "",
      variant: "",
      variantType: "auto",
      note: "",
      productId: null,
    });

    restorePreviousPosition();
  };

  const closeAddRestockForm = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setAddRestockOpen(false);
    setNewRestock({
      quantity: "",
      shipmentFee: "",
      variant: "",
      variantType: "auto",
      note: "",
      productId: null,
    });

    restorePreviousPosition();
  };

  const closeEditSoldModal = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setEditSoldOpen(false);
    setEditingSold(null);

    restorePreviousPosition();
  };

  const closeEditRestockModal = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    setEditRestockOpen(false);
    setEditingRestock(null);

    restorePreviousPosition();
  };

  /* ============================
     ✅ REQUIRED FIX HELPERS
     - Your orders cartItem.productId looks like:
       "3a6TgSKC9hB941amdvjN-green-5l"
     - But cookingitems doc id is ONLY:
       "3a6TgSKC9hB941amdvjN"
     - So we MUST split the productId.
  ============================ */
  const parseCartProductId = (raw = "") => {
    if (!raw || typeof raw !== "string") return { baseId: null, variant: null };
    const parts = raw.split("-");
    const baseId = parts[0] || null;
    const variant = parts.length >= 2 ? parts[1] : null; // e.g. "green"
    return { baseId, variant };
  };

  const normalizeText = (value = "") =>
    value.toString().toLowerCase().trim();

  const isPaidOrderStatus = (statusValue = "") => {
    const status = normalizeText(statusValue);
    if (!status) return false;

    // Important: do NOT let "unpaid" pass just because it contains "paid".
    if (status.includes("unpaid") || status.includes("not paid")) return false;

    return (
      status === "paid" ||
      status === "success" ||
      status === "successful" ||
      status === "completed" ||
      status === "complete" ||
      status === "confirmed" ||
      status.includes("paid")
    );
  };

  const getOrderStatusValue = (order = {}) =>
    order?.payment?.status || order?.orderStatus || order?.status || "";

  const toNum = (value) => {
    if (value == null || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const n = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };

  // ✅ Mirrors the payment dashboard style of deciding whether money was actually recorded.
  // This catches orders that have inflow/amountPaid/balance payment even when orderStatus was not updated.
  const getBalancePaidInfo = (order = {}) => {
    const bp = order?.balancePayment || {};
    const stateRaw = normalizeText(bp?.state || bp?.payment?.state || "");

    const expected =
      toNum(bp?.payment?.amount) ||
      toNum(bp?.payableTotal) ||
      toNum(bp?.amount) ||
      0;

    const inflowPaid =
      toNum(bp?.payment?.inflow?.paidTotal) ||
      toNum(bp?.payment?.inflow?.amountNormalized) ||
      toNum(bp?.payment?.inflow?.amount) ||
      toNum(bp?.payment?.inflow?.amountPaid) ||
      toNum(bp?.payment?.inflow?.["amount paid"]);

    const paidTotal =
      toNum(bp?.amountPaid) ||
      toNum(bp?.payment?.amountPaid) ||
      inflowPaid ||
      0;

    const isPaid = stateRaw === "paid" || (expected > 0 && paidTotal >= expected);
    const isPartial =
      !isPaid &&
      (stateRaw === "partial" || (expected > 0 && paidTotal > 0 && paidTotal < expected));

    return { expected, paidTotal, isPaid, isPartial, state: stateRaw };
  };

  const getOrderPaidInfoForInventory = (order = {}) => {
    const inflow = order?.payment?.inflow || order?.inflow || {};
    const rawPayload = order?.payment?.rawPayload || order?.rawPayload || {};

    const payableAmount =
      toNum(order?.payableTotal) ||
      toNum(order?.payment?.payableTotal) ||
      toNum(rawPayload?.payableTotal) ||
      toNum(order?.payment?.amount) ||
      toNum(order?.grandTotal) ||
      toNum(order?.totalAmount) ||
      0;

    const mainPaidAmount =
      toNum(order?.payment?.amountPaid) ||
      toNum(order?.amountPaid) ||
      toNum(inflow?.paidTotal) ||
      toNum(inflow?.amountNormalized) ||
      toNum(inflow?.amount) ||
      toNum(inflow?.amountPaid) ||
      toNum(inflow?.["amount paid"]) ||
      0;

    const balanceInfo = getBalancePaidInfo(order);
    const balanceCleared =
      balanceInfo.isPaid ||
      (balanceInfo.expected > 0 && balanceInfo.paidTotal >= balanceInfo.expected);

    const paidAmount = balanceCleared
      ? Math.max(payableAmount, mainPaidAmount + balanceInfo.paidTotal)
      : Math.min(payableAmount || mainPaidAmount + balanceInfo.paidTotal, mainPaidAmount + balanceInfo.paidTotal);

    const statusValue = getOrderStatusValue(order);
    const statusPaid = isPaidOrderStatus(statusValue);

    const hasSuccessfulInflow =
      toNum(inflow?.paidTotal) > 0 ||
      toNum(inflow?.amountNormalized) > 0 ||
      toNum(inflow?.amount) > 0 ||
      toNum(inflow?.amountPaid) > 0 ||
      normalizeText(inflow?.status) === "success" ||
      normalizeText(inflow?.status) === "successful";

    const isMarkedPaid =
      statusPaid ||
      !!order?.payment?.paidAt ||
      !!order?.paidAt ||
      balanceCleared ||
      (payableAmount > 0 && paidAmount >= payableAmount);

    const isPaymentRecorded = isMarkedPaid || mainPaidAmount > 0 || balanceInfo.paidTotal > 0 || hasSuccessfulInflow;

    return {
      payableAmount,
      paidAmount,
      isMarkedPaid,
      isPaymentRecorded,
      isUnderpaid: payableAmount > 0 && paidAmount > 0 && paidAmount < payableAmount,
    };
  };

  const shouldCountOrderForInventorySold = (order = {}) => {
    const paid = getOrderPaidInfoForInventory(order);
    return paid.isPaymentRecorded && isOrderCountedForInventory(order);
  };

  const getOrderCartItems = (order = {}) => {
    if (Array.isArray(order?.cart)) return order.cart;
    if (Array.isArray(order?.items)) return order.items;
    if (Array.isArray(order?.orderItems)) return order.orderItems;
    if (Array.isArray(order?.products)) return order.products;
    if (Array.isArray(order?.payment?.rawPayload?.cart)) return order.payment.rawPayload.cart;
    if (Array.isArray(order?.rawPayload?.cart)) return order.rawPayload.cart;
    return [];
  };

  const normalizeMatchKey = (value = "") =>
    value
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");

  const getCartItemName = (cartItem = {}) =>
    cartItem?.name || cartItem?.title || cartItem?.productName || cartItem?.itemName || "";

  const getCartItemVariantName = (cartItem = {}, parsed = {}) => {
    const directVariant =
      cartItem?.variant ||
      cartItem?.color ||
      cartItem?.size ||
      cartItem?.variantName ||
      cartItem?.selectedColor ||
      cartItem?.selectedSize ||
      cartItem?.variants?.color ||
      cartItem?.variants?.size ||
      parsed?.variant ||
      null;

    if (directVariant) return directVariant.toString().trim();

    const variantText = cartItem?.variantText || "";
    if (variantText) {
      const match = variantText.toString().match(/(?:color|size)\s*:\s*([^,]+)/i);
      if (match?.[1]) return match[1].trim();
    }

    return null;
  };

  // ✅ NEW: date filter helpers for inventory sales calculations
  const getStartOfDayFromInput = (dateString = "") => {
    if (!dateString) return null;
    const date = new Date(`${dateString}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  };

  const selectedSalesStartDate = useMemo(
    () => getStartOfDayFromInput(salesStartDate),
    [salesStartDate]
  );

  const toDateValue = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }

    if (typeof value?.toDate === "function") {
      try {
        const date = value.toDate();
        return isNaN(date.getTime()) ? null : date;
      } catch (err) {}
    }

    if (typeof value?.seconds === "number") {
      const date = new Date(value.seconds * 1000);
      return isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "number") {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "string") {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }

    return null;
  };

  const getSoldEntryDateValue = (entry = {}) =>
    entry?.timestamp || entry?.createdAt || entry?.date || entry?.soldAt || null;

  const getOrderDateValue = (order = {}) =>
    order?.payment?.paidAt ||
    order?.payment?.successfulAt ||
    order?.payment?.inflow?.paidAt ||
    order?.payment?.inflow?.createdAt ||
    order?.balancePayment?.paidAt ||
    order?.balancePayment?.payment?.paidAt ||
    order?.shipmentPayment?.paidAt ||
    order?.shipmentPayment?.payment?.paidAt ||
    order?.createdAt ||
    order?.updatedAt ||
    order?.orderDate ||
    order?.orderedAt ||
    order?.date ||
    order?.timestamp ||
    order?.payment?.initiatedAt ||
    order?.payment?.createdAt ||
    null;

  const isDateOnOrAfterSalesStartDate = (value) => {
    if (!selectedSalesStartDate) return true;

    const dateValue = toDateValue(value);

    // If a date filter is active but a record has no readable date,
    // keep it out so old/unknown sales don't affect the new inventory period.
    if (!dateValue) return false;

    return dateValue.getTime() >= selectedSalesStartDate.getTime();
  };

  const isSoldEntryCounted = (entry = {}) =>
    isDateOnOrAfterSalesStartDate(getSoldEntryDateValue(entry));

  const isOrderCountedForInventory = (order = {}) =>
    isDateOnOrAfterSalesStartDate(getOrderDateValue(order));

  const salesStartDateLabel = selectedSalesStartDate
    ? selectedSalesStartDate.toLocaleDateString()
    : "All sales";


  /* ---------------- PRINT INVENTORY (MOBILE SAFE) - kept as-is ---------------- */
  const handlePrintInventory = () => {
    if (!tableRef.current) return;

    try {
      const original = tableRef.current;
      const clone = original.cloneNode(true);

      const removeUnprintables = (root) => {
        Array.from(root.querySelectorAll(".no-print")).forEach((n) => n.remove());
        Array.from(root.querySelectorAll("button")).forEach((b) => b.remove());
        Array.from(
          root.querySelectorAll("a, .action, .actions, [data-action]")
        ).forEach((n) => {
          const txt = (n.textContent || "").trim().toLowerCase();
          if (!txt || txt.length < 3) n.remove();
        });
      };

      const cleanupNode = (el) => {
        if (!el) return;
        if (el.style) {
          el.style.maxHeight = "";
          el.style.height = "";
          el.style.overflow = "";
          el.style.overflowY = "";
          el.style.overflowX = "";
          el.style.position = "";
        }
        try {
          if (el.classList && el.classList.length) {
            el.classList.remove(
              "overflow-x-auto",
              "overflow-y-auto",
              "table-container",
              "max-h-[300px]",
              "sticky",
              "top-0",
              "fixed"
            );
          }
        } catch (err) {}
        if (el.tagName && el.tagName.toLowerCase() === "thead") {
          if (el.style) {
            el.style.position = "";
            el.style.top = "";
          }
        }
        Array.from(el.children || []).forEach(cleanupNode);
      };

      cleanupNode(clone);
      removeUnprintables(clone);

      Array.from(clone.querySelectorAll("[style]")).forEach((n) => {
        const st = n.getAttribute("style") || "";
        if (st.includes("sticky") || st.includes("position:sticky")) {
          n.style.position = "";
          n.style.top = "";
        }
      });
      Array.from(clone.querySelectorAll(".sticky, .top-0")).forEach((n) => {
        try {
          n.classList.remove("sticky", "top-0");
          if (n.style) {
            n.style.position = "";
            n.style.top = "";
          }
        } catch (e) {}
      });

      const css = `
      @page { margin: 12mm; }
      html, body { height: auto; }
      body { font-family: Arial, sans-serif; padding: 8px; font-size: 12px; color: #000; }
      h2 { text-align: center; margin-bottom: 6px; }
      p { margin: 0 0 8px 0; text-align: center; font-size: 12px; }
      table { width: 100% !important; border-collapse: collapse !important; table-layout: auto !important; word-break: break-word; }
      th, td { border: 1px solid #000 !important; padding: 6px !important; text-align: center; font-size: 11px; vertical-align: middle; }
      thead { display: table-header-group; } 
      tfoot { display: table-footer-group; }
      tbody { display: table-row-group; }
      img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
      tr { page-break-inside: auto; page-break-after: auto; }
      td, th { page-break-inside: avoid; }
      .no-print, .print-hide { display: none !important; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        *[style*="max-height"] { max-height: none !important; }
        .sticky, .top-0 { position: static !important; top: auto !important; }
      }
    `;

      const printableHtml = `<!doctype html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Inventory Report</title>
          <style>${css}</style>
        </head>
        <body>
          ${clone.innerHTML}
        </body>
      </html>`;

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        document.body.appendChild(iframe);

        const docu = iframe.contentWindow.document;
        docu.open();
        docu.write(printableHtml);
        docu.close();

        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (err) {
            console.warn("Iframe print failed:", err);
          }
          setTimeout(() => {
            try {
              document.body.removeChild(iframe);
            } catch (e) {}
          }, 500);
        }, 700);

        return;
      }

      printWindow.document.open();
      printWindow.document.write(printableHtml);
      printWindow.document.close();

      const tryPrint = () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (err) {
          console.warn("Print call failed:", err);
        }
      };
      printWindow.onload = () => setTimeout(tryPrint, 300);
      setTimeout(tryPrint, 900);
    } catch (err) {
      console.error("Printing failed:", err);
      toast.error("Unable to print inventory. Please try again or allow pop-ups.");
    }
  };

  // Helpers to safely sum quantities from arrays (item-level)
  const sumRestockedForItem = (item) => {
    if (!item?.restockHistory || !Array.isArray(item.restockHistory)) return 0;
    return item.restockHistory.reduce(
      (acc, entry) => acc + (entry?.quantity || 0),
      0
    );
  };

  const sumSoldHistoryForItem = (item) => {
    if (!item?.soldHistory || !Array.isArray(item.soldHistory)) return 0;
    return item.soldHistory
      .filter((entry) => isSoldEntryCounted(entry))
      .reduce((acc, entry) => acc + (Number(entry?.quantity || 0) || 0), 0);
  };

  // ----------------------
  // ✅ NEW: SOLD INDEX FROM ORDERS (so even if soldHistory/restockHistory is missing,
  //     Qty Sold column can still reflect paid orders)
  // We use MAX(historySold, ordersSold) to avoid double counting
  // when you already synced orders into soldHistory.
  // ----------------------
  const ordersSoldIndex = useMemo(() => {
    const totalSoldByProduct = new Map(); // baseId -> qty
    const variantSoldByKey = new Map(); // `${baseId}__${variantLower}` -> qty

    const safeAdd = (map, key, qty) => {
      if (!key) return;
      const n = Number(qty || 0) || 0;
      if (n <= 0) return;
      map.set(key, (map.get(key) || 0) + n);
    };

    const productIdSet = new Set(
      Array.isArray(cookingitems) ? cookingitems.map((item) => String(item?.id || "")).filter(Boolean) : []
    );

    const productNameToId = new Map();
    if (Array.isArray(cookingitems)) {
      cookingitems.forEach((item) => {
        const id = String(item?.id || "").trim();
        if (!id) return;
        [item?.name, item?.title, item?.productName].filter(Boolean).forEach((name) => {
          const key = normalizeMatchKey(name);
          if (key && !productNameToId.has(key)) productNameToId.set(key, id);
        });
      });
    }

    const resolveProductBaseId = (cartItem = {}) => {
      const rawProductId =
        cartItem?.productId ||
        cartItem?.productID ||
        cartItem?.product_id ||
        cartItem?.product ||
        cartItem?.id ||
        "";

      if (rawProductId) {
        const parsed = parseCartProductId(String(rawProductId || ""));
        if (parsed?.baseId && productIdSet.has(parsed.baseId)) return parsed.baseId;
        if (parsed?.baseId && !productIdSet.size) return parsed.baseId;
      }

      const nameKey = normalizeMatchKey(getCartItemName(cartItem));
      if (nameKey && productNameToId.has(nameKey)) return productNameToId.get(nameKey);

      return null;
    };

    const countableOrders = Array.isArray(orders)
      ? orders.filter((o) => shouldCountOrderForInventorySold(o))
      : [];

    countableOrders.forEach((o) => {
      const cart = getOrderCartItems(o);
      cart.forEach((ci) => {
        const qty = toNum(ci?.quantity ?? ci?.qty ?? ci?.count ?? ci?.pieces ?? 0);
        if (!qty || qty <= 0) return;

        const rawProductId = ci?.productId || ci?.productID || ci?.product_id || ci?.product || ci?.id || "";
        const parsed = parseCartProductId(String(rawProductId || ""));
        const baseId = resolveProductBaseId(ci);
        if (!baseId) return;

        const v = getCartItemVariantName(ci, parsed);

        safeAdd(totalSoldByProduct, baseId, qty);

        if (v) {
          const vKey = `${baseId}__${String(v).toLowerCase().trim()}`;
          safeAdd(variantSoldByKey, vKey, qty);
        }
      });
    });

    return { totalSoldByProduct, variantSoldByKey };
  }, [orders, cookingitems, refreshIndex, selectedSalesStartDate]); // refreshIndex helps if context updates after edits

  const getSoldFromOrdersForItem = (item) => {
    const id = item?.id;
    if (!id) return 0;
    return Number(ordersSoldIndex.totalSoldByProduct.get(id) || 0);
  };

  const getSoldFromOrdersForVariant = (item, variantName) => {
    const id = item?.id;
    const v = (variantName || "").toString().toLowerCase().trim();
    if (!id || !v) return 0;
    const key = `${id}__${v}`;
    return Number(ordersSoldIndex.variantSoldByKey.get(key) || 0);
  };

  // ✅ Effective sold = MAX(history, orders) so table always shows sold qty
  const getEffectiveSoldForItem = (item) => {
    const h = sumSoldHistoryForItem(item);
    const o = getSoldFromOrdersForItem(item);
    return Math.max(Number(h || 0), Number(o || 0));
  };

  /* =======================
     Variant helpers
  ======================= */
  const normalizeColorEntries = (colors) => {
    if (!Array.isArray(colors)) return [];
    return colors.map((c) => {
      if (typeof c === "string") {
        return { name: c, priceOriginal: "", priceDiscounted: "", quantity: 0 };
      }
      return {
        name: c.name || c?.color || "",
        priceOriginal: c.priceOriginal ?? c.price ?? "",
        priceDiscounted: c.priceDiscounted ?? c.discountedPrice ?? "",
        quantity: Number(c.quantity || 0),
        costPrice: c.costPrice ?? undefined,
      };
    });
  };

  const normalizeSizeEntries = (sizes) => {
    if (!Array.isArray(sizes)) return [];
    return sizes.map((s) => {
      if (typeof s === "string") {
        return { name: s, priceOriginal: "", priceDiscounted: "", quantity: 0 };
      }
      return {
        name: s.name || s?.size || "",
        priceOriginal: s.priceOriginal ?? s.price ?? "",
        priceDiscounted: s.priceDiscounted ?? s.discountedPrice ?? "",
        quantity: Number(s.quantity || 0),
        costPrice: s.costPrice ?? undefined,
      };
    });
  };

  /**
   * Sum restock entries that correspond to a specific variant.
   * Heuristics to match: entry.size, entry.color, entry.variantName, entry.variant, or entry.note includes the name.
   */
  const sumRestockedForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.restockHistory || !Array.isArray(item.restockHistory)) return 0;

    const nameLower = variantName?.toString().toLowerCase();
    const matched = item.restockHistory.filter((r) => {
      if (!r) return false;
      if (r.size && r.size.toString().toLowerCase() === nameLower) return true;
      if (r.color && r.color.toString().toLowerCase() === nameLower) return true;
      if (r.variant && r.variant.toString().toLowerCase() === nameLower) return true;
      if (r.variantName && r.variantName.toString().toLowerCase() === nameLower)
        return true;
      if (r.note && r.note.toString().toLowerCase().includes(nameLower)) return true;
      return false;
    });

    return matched.reduce((acc, e) => acc + (e.quantity || 0), 0);
  };

  const sumSoldHistoryForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.soldHistory || !Array.isArray(item.soldHistory)) return 0;

    const nameLower = variantName?.toString().toLowerCase();
    const matched = item.soldHistory.filter((r) => {
      if (!r || !isSoldEntryCounted(r)) return false;
      if (r.size && r.size.toString().toLowerCase() === nameLower) return true;
      if (r.color && r.color.toString().toLowerCase() === nameLower) return true;
      if (r.variant && r.variant.toString().toLowerCase() === nameLower) return true;
      if (r.variantName && r.variantName.toString().toLowerCase() === nameLower)
        return true;
      if (r.note && r.note.toString().toLowerCase().includes(nameLower)) return true;
      return false;
    });

    return matched.reduce((acc, e) => acc + (e.quantity || 0), 0);
  };

  // ✅ Effective sold per variant = MAX(history, orders)
  const getEffectiveSoldForVariant = (item, variantName) => {
    const h = sumSoldHistoryForVariant(item, variantName);
    const o = getSoldFromOrdersForVariant(item, variantName);
    return Math.max(Number(h || 0), Number(o || 0));
  };

  // ✅ Balance: restocked - effectiveSold (so table balance stays realistic)
  const getBalanceForVariant = (item, variantName) => {
    const restocked = sumRestockedForVariant(item, variantName);
    const sold = getEffectiveSoldForVariant(item, variantName);
    return Math.max(0, restocked - sold);
  };

  // Utility to get unit/variant price
  const getVariantUnitPrice = (item, variant) => {
    if (variant?.priceDiscounted) return Number(variant.priceDiscounted) || 0;
    if (variant?.priceOriginal) return Number(variant.priceOriginal) || 0;
    if (item?.priceDiscounted) return Number(item.priceDiscounted) || 0;
    if (item?.priceOriginal) return Number(item.priceOriginal) || 0;
    return 0;
  };

  const getVariantCostPrice = (item, variant) => {
    // prefer variant.costPrice if present, otherwise item.costPrice
    if (variant?.costPrice) return Number(variant.costPrice) || 0;
    return Number(item?.costPrice || 0);
  };

  // ----------------------
  // NEW: generate variant rows for the table
  // ----------------------
  const buildVariantRows = (item) => {
    const colorEntries = normalizeColorEntries(item?.colors);
    const sizeEntries = normalizeSizeEntries(item?.sizes);

    const rows = [];

    if (colorEntries.length > 0) {
      colorEntries.forEach((c) => {
        const restocked = sumRestockedForVariant(item, c.name);
        const sold = getEffectiveSoldForVariant(item, c.name);
        const balance = Math.max(0, restocked - sold);

        rows.push({
          productId: item.id,
          baseName: item.name,
          createdAt: item.createdAt,
          itemIdShort: item.id?.slice?.(0, 6),
          variantType: "Color",
          variantName: c.name,
          restocked,
          sold,
          balance,
          unit: "Piece",
          unitCost: getVariantCostPrice(item, c),
          unitSalePrice: getVariantUnitPrice(item, c),
          originalItem: item,
        });
      });
    }

    if (sizeEntries.length > 0) {
      sizeEntries.forEach((s) => {
        const restocked = sumRestockedForVariant(item, s.name);
        const sold = getEffectiveSoldForVariant(item, s.name);
        const balance = Math.max(0, restocked - sold);

        rows.push({
          productId: item.id,
          baseName: item.name,
          createdAt: item.createdAt,
          itemIdShort: item.id?.slice?.(0, 6),
          variantType: "Size",
          variantName: s.name,
          restocked,
          sold,
          balance,
          unit: "Piece",
          unitCost: getVariantCostPrice(item, s),
          unitSalePrice: getVariantUnitPrice(item, s),
          originalItem: item,
        });
      });
    }

    // if neither variants exist — fallback to top-level row
    if (rows.length === 0) {
      const totalRestocked = sumRestockedForItem(item);
      const totalSold = getEffectiveSoldForItem(item);
      const qtyBalance = Math.max(0, totalRestocked - totalSold);

      rows.push({
        productId: item.id,
        baseName: item.name,
        createdAt: item.createdAt,
        itemIdShort: item.id?.slice?.(0, 6),
        variantType: "N/A",
        variantName: "-",
        restocked: totalRestocked,
        sold: totalSold,
        balance: qtyBalance,
        unit: "Piece",
        unitCost: Number(item.costPrice || 0),
        unitSalePrice: Number(item.priceDiscounted || item.priceOriginal || 0),
        originalItem: item,
      });
    }

    return rows;
  };

  // ----------------------
  // ✅ TOTAL item balance
  // Qty Balance must always be:
  // Qty Restocked - Qty Sold
  // This prevents the balance from showing 0 when restockHistory and soldHistory/orders have values.
  // ----------------------
  const getItemBalanceTotal = (item) => {
    const colorEntries = normalizeColorEntries(item?.colors);
    const sizeEntries = normalizeSizeEntries(item?.sizes);

    if (colorEntries.length > 0 || sizeEntries.length > 0) {
      return [...colorEntries, ...sizeEntries].reduce((total, variant) => {
        const restocked = sumRestockedForVariant(item, variant.name);
        const sold = getEffectiveSoldForVariant(item, variant.name);
        return total + Math.max(0, restocked - sold);
      }, 0);
    }

    const totalRestocked = sumRestockedForItem(item);
    const totalSold = getEffectiveSoldForItem(item);
    return Math.max(0, totalRestocked - totalSold);
  };

  // ----------------------
  // Utility to safely add/subtract quantity in a variant array (colors or sizes)
  // ----------------------
  const updateVariantInArray = (arr = [], variantName, qtyDiff) => {
    const copy = Array.isArray(arr) ? arr.slice() : [];
    const idx = copy.findIndex((v) => {
      const name = typeof v === "string" ? v : v?.name;
      return (
        (name || "").toString().toLowerCase() ===
        (variantName || "").toString().toLowerCase()
      );
    });
    if (idx >= 0) {
      const v = copy[idx];
      const currentQty = Number(typeof v === "string" ? 0 : v.quantity || 0);
      copy[idx] = {
        ...(typeof v === "string" ? { name: v } : v),
        quantity: Math.max(0, currentQty + Number(qtyDiff)),
      };
    } else {
      copy.push({
        name: variantName,
        priceOriginal: "",
        priceDiscounted: "",
        quantity: Math.max(0, Number(qtyDiff)),
      });
    }
    return copy;
  };

  // ----------------------
  // NEW: add restock functionality (variant-aware)
  // ----------------------
  const addRestock = async ({
    productId,
    quantity,
    shipmentFee,
    variantName,
    variantType,
    note,
  }) => {
    if (!isAdmin) {
      toast.error("You don't have permission to restock");
      return false;
    }
    const q = Number(quantity || 0);
    if (!productId || !q || q <= 0) {
      toast.error("Provide a positive quantity to restock");
      return false;
    }

    try {
      const resolvedProduct = await resolveExistingProductRef(productId);
      const ref = resolvedProduct.ref;
      const snap = resolvedProduct.snap;

      if (!ref || !snap?.exists()) {
        console.error("Product not found in any supported CHAREX path:", {
          productId,
          checkedPaths: getProductRefCandidates(productId).map(
            (candidate) => candidate.ref.path
          ),
        });
        toast.error(
          "Product not found. Reload the product list and try again."
        );
        return false;
      }

      const data = snap.data();

      const entry = {
        id: uuidv4(),
        adminId: currentUser?.uid || "unknown",
        quantity: q,
        shipmentFee: shipmentFee ?? null,
        timestamp: new Date(),
        productId,
        note: note || "",
      };

      if (variantName) {
        let vType = variantType;
        if (vType === "auto") {
          const hasColor =
            Array.isArray(data.colors) &&
            data.colors.some((c) => {
              const n = typeof c === "string" ? c : c?.name;
              return (
                n?.toString().toLowerCase() ===
                variantName.toString().toLowerCase()
              );
            });
          const hasSize =
            Array.isArray(data.sizes) &&
            data.sizes.some((s) => {
              const n = typeof s === "string" ? s : s?.name;
              return (
                n?.toString().toLowerCase() ===
                variantName.toString().toLowerCase()
              );
            });
          if (hasColor) vType = "color";
          else if (hasSize) vType = "size";
          else vType = "unknown";
        }

        if (vType === "color") entry.color = variantName;
        else if (vType === "size") entry.size = variantName;
        else entry.variantName = variantName;
      }

      const updates = {};
      if (variantName && entry.color) {
        updates.colors = updateVariantInArray(data.colors || [], variantName, q);
      } else if (variantName && entry.size) {
        updates.sizes = updateVariantInArray(data.sizes || [], variantName, q);
      }

      const updateObj = {
        restockHistory: arrayUnion(entry),
        quantity: increment(q),
        ...(updates.colors ? { colors: updates.colors } : {}),
        ...(updates.sizes ? { sizes: updates.sizes } : {}),
      };

      await updateDoc(ref, updateObj);

      if (modalItem && modalItem.id === productId) {
        const refreshed = await getDoc(ref);
        setModalItem({ id: refreshed.id, ...refreshed.data() });
      }

      toast.success("Restock recorded and inventory updated");
      setAddRestockOpen(false);
      setNewRestock({
        quantity: "",
        shipmentFee: "",
        variant: "",
        variantType: "auto",
        note: "",
        productId: null,
      });
      setRefreshIndex((i) => i + 1);
      restorePreviousPosition();
      return true;
    } catch (err) {
      console.error("Add restock failed:", err);
      toast.error("Failed to add restock");
      return false;
    }
  };

  const handleOpenAddRestock = (product, variantName = "", variantType = "auto") => {
    rememberCurrentPosition();
    setModalItem(product);
    setAddRestockOpen(true);
    setNewRestock({
      quantity: "",
      shipmentFee: "",
      variant: variantName || "",
      variantType: variantType || "auto",
      note: "",
      productId: product.id,
    });
    if (!modalOpen) setModalOpen(true);
  };

  // ----------------------
  // Save edited restock: adjust variant arrays & top-level quantity
  // ----------------------
  const saveEditedRestock = async () => {
    if (!editingRestock) return;
    if (!isAdmin) {
      toast.error("You don't have permission");
      return;
    }

    const { productId, entryId, quantity, shipmentFee, size, note } = editingRestock;
    const newQty = Number(quantity || 0);

    try {
      const resolvedProduct = await resolveExistingProductRef(productId);
      const ref = resolvedProduct.ref;
      const snap = resolvedProduct.snap;

      if (!ref || !snap?.exists()) {
        console.error("Product not found in any supported CHAREX path:", {
          productId,
          checkedPaths: getProductRefCandidates(productId).map(
            (candidate) => candidate.ref.path
          ),
        });
        toast.error(
          "Product not found. Reload the product list and try again."
        );
        return;
      }

      const data = snap.data();

      const oldEntry = (data.restockHistory || []).find((r) => r.id === entryId);
      if (!oldEntry) {
        toast.error("Restock entry not found");
        return;
      }

      const oldQty = Number(oldEntry.quantity || 0);
      const qtyDiff = newQty - oldQty;

      const oldVariantName =
        oldEntry.color || oldEntry.size || oldEntry.variantName || null;
      const oldVariantType = oldEntry.color
        ? "color"
        : oldEntry.size
        ? "size"
        : oldEntry.variantName
        ? "variant"
        : null;

      const newVariantName = (
        size ||
        editingRestock.size ||
        oldEntry.size ||
        oldEntry.color ||
        oldEntry.variantName ||
        ""
      )
        .toString()
        .trim() || null;

      let newVariantType = null;
      if (newVariantName) {
        const hasColor =
          Array.isArray(data.colors) &&
          data.colors.some(
            (c) =>
              ((typeof c === "string" ? c : c?.name) || "")
                .toLowerCase()
                .trim() === newVariantName.toLowerCase()
          );
        const hasSize =
          Array.isArray(data.sizes) &&
          data.sizes.some(
            (s) =>
              ((typeof s === "string" ? s : s?.name) || "")
                .toLowerCase()
                .trim() === newVariantName.toLowerCase()
          );
        if (hasColor) newVariantType = "color";
        else if (hasSize) newVariantType = "size";
        else newVariantType = "variant";
      }

      const updatedHistory = (data.restockHistory || []).map((r) =>
        r.id === entryId
          ? {
              ...r,
              quantity: newQty,
              shipmentFee: shipmentFee ?? r.shipmentFee,
              size: size ?? r.size,
              note: note ?? r.note,
            }
          : r
      );

      let colorsArr = Array.isArray(data.colors) ? data.colors.slice() : [];
      let sizesArr = Array.isArray(data.sizes) ? data.sizes.slice() : [];

      if (
        oldVariantName &&
        (!newVariantName ||
          newVariantName.toString().toLowerCase() !==
            oldVariantName.toString().toLowerCase())
      ) {
        if (oldVariantType === "color")
          colorsArr = updateVariantInArray(colorsArr, oldVariantName, -oldQty);
        else if (oldVariantType === "size")
          sizesArr = updateVariantInArray(sizesArr, oldVariantName, -oldQty);
      }

      if (newVariantName) {
        if (
          oldVariantName &&
          newVariantName.toString().toLowerCase() ===
            oldVariantName.toString().toLowerCase()
        ) {
          if (newVariantType === "color")
            colorsArr = updateVariantInArray(colorsArr, newVariantName, qtyDiff);
          else if (newVariantType === "size")
            sizesArr = updateVariantInArray(sizesArr, newVariantName, qtyDiff);
        } else {
          if (newVariantType === "color")
            colorsArr = updateVariantInArray(colorsArr, newVariantName, newQty);
          else if (newVariantType === "size")
            sizesArr = updateVariantInArray(sizesArr, newVariantName, newQty);
        }
      }

      const updates = {
        restockHistory: updatedHistory,
        quantity: increment(qtyDiff),
      };
      if (colorsArr) updates.colors = colorsArr;
      if (sizesArr) updates.sizes = sizesArr;

      await updateDoc(ref, updates);

      const refreshed = await getDoc(ref);
      setModalItem({ id: refreshed.id, ...refreshed.data() });

      toast.success("Restock entry updated");
      setEditRestockOpen(false);
      setEditingRestock(null);
      setRefreshIndex((i) => i + 1);
      restorePreviousPosition();
    } catch (err) {
      console.error("Failed to save edited restock:", err);
      toast.error("Failed to save restock edit");
    }
  };

  // ----------------------
  // Delete restock: adjust variant arrays as well
  // ----------------------
  const handleDeleteRestock = async (e, item, entry) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (!isAdmin) {
      toast.error("You don't have permission to delete restock records");
      return;
    }

    const ok = window.confirm(`Delete this restock entry?\n\nQuantity: ${entry.quantity}`);
    if (!ok) return;

    try {
      const resolvedProduct = await resolveExistingProductRef(item.id);
      const ref = resolvedProduct.ref;
      const snap = resolvedProduct.snap;

      if (!ref || !snap?.exists()) {
        toast.error("Product not found. Reload and try again.");
        return;
      }

      const data = snap.data();

      const updatedHistory = (data.restockHistory || []).filter((r) => r.id !== entry.id);

      const qty = Number(entry.quantity || 0);

      let colorsArr = Array.isArray(data.colors) ? data.colors.slice() : [];
      let sizesArr = Array.isArray(data.sizes) ? data.sizes.slice() : [];

      if (entry.color) colorsArr = updateVariantInArray(colorsArr, entry.color, -qty);
      else if (entry.size) sizesArr = updateVariantInArray(sizesArr, entry.size, -qty);
      else if (entry.variantName) {
        colorsArr = updateVariantInArray(colorsArr, entry.variantName, -qty);
        sizesArr = updateVariantInArray(sizesArr, entry.variantName, -qty);
      }

      const updateFields = {
        restockHistory: updatedHistory,
        quantity: increment(-qty),
      };
      if (colorsArr) updateFields.colors = colorsArr;
      if (sizesArr) updateFields.sizes = sizesArr;

      await updateDoc(ref, updateFields);

      setModalItem((prev) => ({
        ...prev,
        restockHistory: prev.restockHistory.filter((r) => r.id !== entry.id),
        colors: colorsArr,
        sizes: sizesArr,
        quantity: (prev.quantity || 0) - qty,
      }));

      toast.success("Restock entry deleted and inventory adjusted");
      setRefreshIndex((i) => i + 1);
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete restock entry");
    }
  };

  // ----------------------
  // helper to find product id by name in cookingitems context (fallback)
  // ----------------------
  const findProductByName = (name) => {
    if (!name || !Array.isArray(cookingitems)) return null;
    const lower = name.toString().toLowerCase();
    return cookingitems.find(
      (ci) => (ci.name || "").toString().toLowerCase() === lower
    );
  };

  /* ============================================================
     ✅✅✅ LATEST FIX THAT STOPPED REPEATED DEDUCTIONS
     1) Uses runTransaction to read latest order doc
     2) HARD STOP if order.inventoryAdjusted === true
     3) Writes inventoryAdjusted=true INSIDE SAME transaction (atomic)
     4) Adds soldHistory entry with adjustKey for dedupe even if rerun
     5) Handles productId like "baseId-variant-..." using parseCartProductId()
     6) Batches orders with limited concurrency so UI doesn't hang
  ============================================================ */

  // Helper: chunk array
  const chunkArray = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  // ✅ CORRECT: Sync PAID user-orders -> CHAREX products inventory (no double-deduct)
  // Works with your real structure: charex/main/users/{userId}/orders/{orderId}
  const applyInventoryAdjustments = async () => {
    if (!isAdmin) {
      toast.error("You don't have permission to sync inventory");
      return;
    }

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      toast.info("No orders available to process");
      return;
    }

    const proceed = window.confirm(
      `This will apply PAID orders to inventory (decrement stock) for orders not yet adjusted.\n\nSales date filter: ${salesStartDateLabel}.\nOnly orders from the selected date upward will be processed. Proceed?`
    );
    if (!proceed) return;

    setProcessingSync(true);
    setSyncProgress({ total: 0, processed: 0, skipped: 0, failed: 0 });

    // small debug helpers
    const dbg = (...args) => console.log("[INV-SYNC]", ...args);
    const dbgErr = (...args) => console.error("[INV-SYNC]", ...args);

    try {
      // Count orders the same way the payment dashboard does: status OR any recorded inflow/amountPaid.
      const paidOrders = orders.filter((o) => shouldCountOrderForInventorySold(o));

      setSyncProgress((p) => ({ ...p, total: paidOrders.length }));

      let processed = 0;
      let skipped = 0;
      let failed = 0;

      // Concurrency control: number of orders processed in parallel (tuneable)
      const CONCURRENCY = 4;
      const batches = chunkArray(paidOrders, CONCURRENCY);

      // process a single order and return outcome
      const processOrder = async (order) => {
        const orderDocId = order.id || order.orderId || order.orderDocId; // support variants
        const userId = order.userId || order?.customer?.userId || order?.uid;

        dbg("Processing order:", { orderDocId, userId });

        if (!orderDocId || !userId) {
          dbgErr("Missing orderId or userId. Skipping", { orderDocId, userId });
          return { status: "skipped", reason: "missing-order-or-user" };
        }

        try {
          await runTransaction(db, async (tx) => {
            const orderRef = doc(db, "charex", "main", "users", userId, "orders", orderDocId);
            const orderSnap = await tx.get(orderRef);

            if (!orderSnap.exists()) {
              throw new Error(`Order ${orderDocId} not found under charex/main/users/${userId}/orders`);
            }

            const freshOrder = orderSnap.data();

            // HARD STOP: already adjusted
            if (freshOrder.inventoryAdjusted === true) {
              dbg("Order already adjusted, skipping:", orderDocId);
              // return early from transaction by not doing any writes
              return;
            }

            const freshOrderForPaymentCheck = { ...order, ...freshOrder, id: orderDocId, userId };
            const isPaid = shouldCountOrderForInventorySold(freshOrderForPaymentCheck);
            if (!isPaid) {
              dbg("Order has no recorded successful payment/inflow (skipping):", {
                orderId: orderDocId,
                status: getOrderStatusValue(freshOrder),
              });
              return;
            }

            const cart = getOrderCartItems(freshOrder);

            // We'll accumulate product updates per productId to minimize tx.update calls
            // Map of productBaseId -> { prodRef, colorsArr, sizesArr, quantityVal, soldEntries }
            const prodUpdates = new Map();

            for (const cartItem of cart) {
              const qty = Number(cartItem.quantity || cartItem.qty || 0);
              if (!qty || qty <= 0) continue;

              let rawProductId =
                cartItem.productId ||
                cartItem.productID ||
                cartItem.product_id ||
                cartItem.product ||
                cartItem.id ||
                null;

              let parsed = parseCartProductId(String(rawProductId || ""));
              let productBaseId = parsed.baseId;

              if (!productBaseId) {
                const found = findProductByName(getCartItemName(cartItem));
                if (found) {
                  rawProductId = found.id;
                  parsed = parseCartProductId(String(rawProductId));
                  productBaseId = parsed.baseId;
                }
              }

              if (!productBaseId) continue;

              const variantName = getCartItemVariantName(cartItem, parsed);

              // Load or prepare product update container
              if (!prodUpdates.has(productBaseId)) {
                const resolvedProduct = await resolveExistingProductRef(
                  productBaseId,
                  tx
                );
                const prodRef = resolvedProduct.ref;
                const prodSnap = resolvedProduct.snap;

                if (!prodRef || !prodSnap?.exists()) {
                  dbgErr("Product no longer exists in any supported path:", {
                    productBaseId,
                    checkedPaths: getProductRefCandidates(productBaseId).map(
                      (candidate) => candidate.ref.path
                    ),
                  });
                  // mark so we don't try updates for this product
                  prodUpdates.set(productBaseId, { skip: true });
                  continue;
                }

                const prodData = prodSnap.data();

                prodUpdates.set(productBaseId, {
                  prodRef,
                  prodData,
                  colorsArr: Array.isArray(prodData.colors) ? prodData.colors.slice() : [],
                  sizesArr: Array.isArray(prodData.sizes) ? prodData.sizes.slice() : [],
                  quantityVal: Number(prodData.quantity || 0),
                  soldEntries: [],
                });
              }

              const container = prodUpdates.get(productBaseId);
              if (!container || container.skip) continue;

              const { prodData } = container;

              // Unique key per order+product+variant
              const uniqueKey = `${orderDocId}_${productBaseId}_${(variantName || "NOVAR")
                .toString()
                .toLowerCase()}`;

              // Prevent duplicates if already logged in existing prodData.soldHistory
              const alreadyLogged = Array.isArray(prodData.soldHistory)
                ? prodData.soldHistory.some((s) => s?.adjustKey === uniqueKey)
                : false;

              // Also check entries we already intend to add in this transaction
              const willBeLogged = container.soldEntries.some((s) => s.adjustKey === uniqueKey);

              if (alreadyLogged || willBeLogged) {
                dbg("Already logged for this product/variant, skipping entry", { uniqueKey });
                continue;
              }

              // Prepare sold entry
              const soldEntry = {
                id: uuidv4(),
                adjustKey: uniqueKey,
                orderId: orderDocId,
                quantity: qty,
                timestamp: new Date(),
                userId: freshOrder.userId || userId || null,
                note: `Auto-adjust from order ${orderDocId}`,
                ...(variantName ? { variantName } : {}),
              };

              // accumulate sold entries
              container.soldEntries.push(soldEntry);

              // update variant arrays local copy
              if (variantName) {
                const vLower = variantName.toString().toLowerCase();
                const inColors = container.colorsArr.some(
                  (c) =>
                    ((typeof c === "string" ? c : c?.name) || "").toLowerCase().trim() === vLower
                );
                const inSizes = container.sizesArr.some(
                  (s) =>
                    ((typeof s === "string" ? s : s?.name) || "").toLowerCase().trim() === vLower
                );

                if (inColors) {
                  container.colorsArr = updateVariantInArray(container.colorsArr, variantName, -qty);
                } else if (inSizes) {
                  container.sizesArr = updateVariantInArray(container.sizesArr, variantName, -qty);
                } else {
                  dbgErr("Variant not found on product; deducted top-level quantity only", {
                    productBaseId,
                    variantName,
                    qty,
                  });
                }

                container.quantityVal = Math.max(0, container.quantityVal - qty);
              } else {
                // top-level product decrement
                container.quantityVal = Math.max(0, container.quantityVal - qty);
              }
            } // end for cart items

            // Apply updates to products (single update per product)
            for (const [productBaseId, container] of prodUpdates.entries()) {
              if (container.skip) continue;
              const { prodRef, soldEntries, colorsArr, sizesArr, quantityVal } = container;
              if (soldEntries.length === 0) continue;
              // Use arrayUnion to append entries atomically
              tx.update(prodRef, {
                soldHistory: arrayUnion(...soldEntries),
                ...(Array.isArray(colorsArr) ? { colors: colorsArr } : {}),
                ...(Array.isArray(sizesArr) ? { sizes: sizesArr } : {}),
                quantity: quantityVal,
              });
            }

            // Mark the order adjusted inside same transaction
            tx.update(orderRef, {
              inventoryAdjusted: true,
              inventoryAdjustedAt: new Date(),
            });

            // transaction complete
            return;
          }); // end transaction

          return { status: "processed" };
        } catch (err) {
          dbgErr("Order processing failed for", { orderDocId, userId, error: err?.message || err });
          // allow caller to tally failed
          return { status: "failed", reason: err?.message || "transaction-failed" };
        }
      }; // end processOrder

      // Execute batches sequentially but orders inside batch in parallel
      for (const batch of batches) {
        const promises = batch.map((o) => processOrder(o));
        const results = await Promise.all(promises);

        results.forEach((res) => {
          if (res.status === "processed") processed++;
          else if (res.status === "skipped") skipped++;
          else if (res.status === "failed") failed++;
        });

        setSyncProgress({ total: paidOrders.length, processed, skipped, failed });
      }

      toast.success(
        `Inventory sync finished. Processed: ${processed}, Skipped: ${skipped}, Failed: ${failed}`
      );
      setRefreshIndex((i) => i + 1);
    } catch (err) {
      console.error("applyInventoryAdjustments failed:", err);
      toast.error("Failed to sync inventory from orders.");
    } finally {
      setProcessingSync(false);
      console.log("[INV-SYNC] SYNC END");
    }
  };

  // ----------------------
  // aggregate filtered items into rows for table rendering
  // ----------------------
  const filteredItems = (cookingitems || []).filter((item) =>
    item.name?.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  // Compute totals
  const totalQtyRestocked = filteredItems.reduce(
    (acc, item) => acc + sumRestockedForItem(item),
    0
  );

  // ✅ Total Sold should also reflect orders when soldHistory missing (without double count)
  const totalQtySold = filteredItems.reduce((acc, item) => acc + getEffectiveSoldForItem(item), 0);

  // ✅ balance now uses restocked - effective sold (variant aware)
  const totalQtyBalance = filteredItems.reduce((acc, item) => acc + getItemBalanceTotal(item), 0);

  const totalCostPrice = filteredItems.reduce((acc, item) => acc + (item.costPrice || 0), 0);

  const totalCostValue = filteredItems.reduce((acc, item) => {
    return acc + Number(item.costPrice || 0) * Number(getItemBalanceTotal(item) || 0);
  }, 0);

  const totalSalesPrice = filteredItems.reduce(
    (acc, item) => acc + (item.priceDiscounted || 0),
    0
  );

  const totalSalesPriceValue = filteredItems.reduce((acc, item) => {
    return (
      acc +
      Number(item.priceDiscounted || item.priceOriginal || 0) *
        Number(getItemBalanceTotal(item) || 0)
    );
  }, 0);

  const totalItemValue = totalSalesPriceValue;
  const totalItems = filteredItems.length;

  // Utility to convert Firestore Timestamp (or Date) to readable date
  const formatDate = (val) => {
    if (!val) return "-";
    if (val?.seconds) return new Date(val.seconds * 1000).toLocaleString();
    if (val instanceof Date) return val.toLocaleString();
    try {
      const d = new Date(val);
      if (!isNaN(d)) return d.toLocaleString();
    } catch {}
    return "-";
  };

  const renderFooter = () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-center">
      <div>Total Products: {totalItems}</div>
      <div>Total Store Value: ₦{totalItemValue.toLocaleString()}</div>
      <div>
        Out Of Stock: {filteredItems.filter((i) => getItemBalanceTotal(i) <= 0).length}
      </div>
      <div>All Categories: {new Set(filteredItems.map((i) => i.category)).size}</div>
    </div>
  );

  const getVariantTypeForName = (item, variantName) => {
    const v = String(variantName || "").toLowerCase().trim();
    if (!v || v === "-" || v === "n/a") return "N/A";

    const colorEntries = normalizeColorEntries(item?.colors);
    const sizeEntries = normalizeSizeEntries(item?.sizes);

    const isColor = colorEntries.some(
      (c) => String(c?.name || "").toLowerCase().trim() === v
    );
    if (isColor) return "Color";

    const isSize = sizeEntries.some(
      (sz) => String(sz?.name || "").toLowerCase().trim() === v
    );
    if (isSize) return "Size";

    return "Variant";
  };

  const getSoldEntryVariantName = (entry = {}) => {
    const variant =
      entry?.variantName ||
      entry?.color ||
      entry?.size ||
      entry?.variant ||
      entry?.selectedColor ||
      entry?.selectedSize ||
      "";

    return String(variant || "-").trim() || "-";
  };

  const getSoldEntryVariantType = (item, entry = {}) => {
    if (entry?.color) return "Color";
    if (entry?.size) return "Size";
    return getVariantTypeForName(item, getSoldEntryVariantName(entry));
  };

  const getVariantUniqueId = (productId, variantName) => {
    const base = String(productId || "").trim();
    const variant = String(variantName || "").toLowerCase().trim();
    if (!base) return "-";
    if (!variant || variant === "-" || variant === "n/a") return base;
    return `${base}-${variant.replace(/\s+/g, "-")}`;
  };

  const handleRowClick = (item, row = null) => {
    rememberCurrentPosition();
    setModalItem(item);
    setModalVariant(
      row && row.variantName && row.variantName !== "-"
        ? {
            variantName: row.variantName,
            variantType: row.variantType || getVariantTypeForName(item, row.variantName),
            variantId: getVariantUniqueId(row.productId || item?.id, row.variantName),
          }
        : null
    );
    setModalOpen(true);
  };

  // -------------------------
  // Action button handlers
  // -------------------------
  const handleEditClick = (e, item) => {
    e.stopPropagation();
    navigate(`/admin/edit-product/${item.id}`, { state: { item } });
  };

  const handleEditRestock = (e, item, entry) => {
    e?.preventDefault();
    e?.stopPropagation();
    rememberCurrentPosition();

    setEditingRestock({
      productId: item.id,
      entryId: entry.id,
      quantity: entry.quantity,
      shipmentFee: entry.shipmentFee ?? "",
      size: entry.size ?? entry.color ?? entry.variantName ?? "",
      note: entry.note ?? "",
    });
    setEditRestockOpen(true);
  };

  const handleEditSold = (e, item, entry) => {
    e?.preventDefault();
    e?.stopPropagation();
    rememberCurrentPosition();

    setEditingSold({
      productId: item.id,
      entryId: entry.id,
      quantity: entry.quantity,
      timestamp: entry.timestamp,
      variantName: getSoldEntryVariantName(entry),
      variantType: getSoldEntryVariantType(item, entry),
    });
    setEditSoldOpen(true);
  };

  const handleDeleteSold = async (e, item, entry) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (!isAdmin) {
      toast.error("You don't have permission to delete sales records");
      return;
    }

    const ok = window.confirm(`Delete this sold entry?\n\nQuantity: ${entry.quantity}`);
    if (!ok) return;

    try {
      const resolvedProduct = await resolveExistingProductRef(item.id);
      const ref = resolvedProduct.ref;
      const snap = resolvedProduct.snap;

      if (!ref || !snap?.exists()) {
        toast.error("Product not found. Reload and try again.");
        return;
      }

      const data = snap.data();

      const updatedHistory = (data.soldHistory || []).filter((s) => s.id !== entry.id);
      const qty = Number(entry.quantity || 0);

      let colorsArr = Array.isArray(data.colors) ? data.colors.slice() : [];
      let sizesArr = Array.isArray(data.sizes) ? data.sizes.slice() : [];

      const variantName = entry.variantName || entry.color || entry.size || null;

      if (variantName) {
        const variantLower = variantName.toString().toLowerCase();
        const inColors = colorsArr.some(
          (c) =>
            ((typeof c === "string" ? c : c?.name) || "").toLowerCase() === variantLower
        );
        const inSizes = sizesArr.some(
          (s) =>
            ((typeof s === "string" ? s : s?.name) || "").toLowerCase() === variantLower
        );

        if (inColors) colorsArr = updateVariantInArray(colorsArr, variantName, qty);
        else if (inSizes) sizesArr = updateVariantInArray(sizesArr, variantName, qty);
        else {
          colorsArr = updateVariantInArray(colorsArr, variantName, qty);
          sizesArr = updateVariantInArray(sizesArr, variantName, qty);
        }
      }

      await updateDoc(ref, {
        soldHistory: updatedHistory,
        quantity: increment(qty),
        ...(colorsArr ? { colors: colorsArr } : {}),
        ...(sizesArr ? { sizes: sizesArr } : {}),
      });

      setModalItem((prev) => ({
        ...prev,
        soldHistory: prev.soldHistory.filter((s) => s.id !== entry.id),
        colors: colorsArr,
        sizes: sizesArr,
        quantity: (prev.quantity || 0) + qty,
      }));

      toast.success("Sold entry deleted");
      setRefreshIndex((i) => i + 1);
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete sold entry");
    }
  };

  // -------------------------
  // Render
  // -------------------------
  return (
    <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 px-4 md:px-0">
      <div className="flex-1">
        {/* Header */}
        <div className="mb-8 p-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={handleReload} className="p-2 bg-gray-200 rounded">
              Reload
            </button>

            {/* Sync orders -> inventory button (admin only) */}
            {isAdmin && (
              <button
                onClick={applyInventoryAdjustments}
                disabled={processingSync}
                className="p-2 bg-yellow-600 text-white rounded"
                title="Sync paid orders to inventory"
              >
                {processingSync
                  ? `Syncing... (${syncProgress.processed}/${syncProgress.total})`
                  : "Apply Orders to Inventory"}
              </button>
            )}
          </div>

          <h2 className="text-2xl font-bold text-center flex-grow">Inventory</h2>
          <button
            className="text-blue-500 cursor-pointer"
            onClick={() => window.history.back()}
          >
            Back
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          {renderStatCard("Total Products", totalItems.toString(), "blue")}
          {renderStatCard("Total Store Value", `₦${totalItemValue.toLocaleString()}`, "green")}
          {renderStatCard(
            "Out Of Stock",
            filteredItems.filter((i) => getItemBalanceTotal(i) <= 0).length.toString(),
            "red"
          )}
          {renderStatCard(
            "All Categories",
            new Set(filteredItems.map((i) => i.category)).size.toString(),
            "gray"
          )}
        </div>

        {/* Search */}
        <div className="mb-4 flex flex-col md:flex-row md:items-center md:space-x-2 space-y-2 md:space-y-0">
          <input
            type="text"
            className="border border-gray-300 rounded-md p-2 w-full md:w-auto"
            placeholder="Search Product by Name"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
          />

          <div className="flex flex-col md:flex-row md:items-center gap-2 no-print">
            <label className="text-sm font-semibold text-gray-700">
              Count sales from:
            </label>
            <input
              type="date"
              className="border border-gray-300 rounded-md p-2 w-full md:w-auto"
              value={salesStartDate}
              onChange={(e) => setSalesStartDate(e.target.value)}
              title="Inventory will only count sold items from this date upward"
            />
            {salesStartDate && (
              <button
                type="button"
                className="px-3 py-2 bg-gray-200 rounded text-sm"
                onClick={() => setSalesStartDate("")}
                title="Count all sales again"
              >
                Clear Date
              </button>
            )}
          </div>

          <div className="mb-4 flex justify-end no-print">
            <button
              onClick={handlePrintInventory}
              className="bg-blue-600 text-white px-4 py-2 rounded"
            >
              Print Inventory
            </button>
          </div>
        </div>

        {/* Table */}
        <div
          className="table-container overflow-x-auto overflow-y-auto"
          style={{ maxHeight: "300px" }}
          ref={tableRef}
        >
          <div className="text-center mb-4">
            <h2 className="text-2xl font-bold underline">Inventory Report</h2>
            <p>Report Printed On: {getCurrentDate()}</p>
            <p>Sales Counted From: {salesStartDateLabel}</p>
          </div>

          <table className="w-full table-auto border-collapse border border-black">
            <thead className="bg-gradient-to-r from-[#4c1d95] via-[#7b2cbf] to-[#45a864] text-white sticky top-0">
              <tr>
                <th className="border p-1">S/n</th>
                <th className="border p-1">Name</th>
                <th className="border p-1">Date</th>
                <th className="border p-1">Item ID</th>
                <th className="border p-1">Variant Type</th>
                <th className="border p-1">Variant</th>
                <th className="border p-1">Qty Restocked</th>
                <th className="border p-1">Qty Sold</th>
                <th className="border p-1">Qty Balance</th>
                <th className="border p-1">Unit</th>
                <th className="border p-1">Unit Cost</th>
                <th className="border p-1">Total Cost</th>
                <th className="border p-1">Unit S/Price</th>
                <th className="border p-1">Total S/Price</th>
                <th className="border p-1">Actions</th>
              </tr>
            </thead>

            <tbody>
              {(() => {
                const allRows = [];
                filteredItems.forEach((item) => {
                  const vrows = buildVariantRows(item);
                  vrows.forEach((r) => allRows.push(r));
                });

                let serial = 0;
                return allRows.map((row) => {
                  serial += 1;
                  const totalCost = (row.unitCost || 0) * (row.balance || 0);
                  const totalSale = (row.unitSalePrice || 0) * (row.balance || 0);

                  return (
                    <tr
                      key={`${row.productId}-${row.variantType}-${row.variantName}-${serial}`}
                      className="cursor-pointer hover:bg-gray-100"
                      onClick={() => handleRowClick(row.originalItem, row)}
                    >
                      <td className="border p-1">{serial}</td>
                      <td className="border p-1">{row.baseName}</td>
                      <td className="border p-1">
                        {row.createdAt ? formatDate(row.createdAt) : "-"}
                      </td>
                      <td className="border p-1">{row.itemIdShort}</td>

                      <td className="border p-1">{row.variantType}</td>
                      <td className="border p-1">{row.variantName}</td>

                      <td className="border p-1">{row.restocked}</td>
                      <td className="border p-1">{row.sold}</td>
                      <td className="border p-1">{row.balance}</td>
                      <td className="border p-1">{row.unit}</td>
                      <td className="border p-1">₦{(row.unitCost || 0).toLocaleString()}</td>
                      <td className="border p-1">₦{(totalCost || 0).toLocaleString()}</td>
                      <td className="border p-1">
                        ₦{(row.unitSalePrice || 0).toLocaleString()}
                      </td>
                      <td className="border p-1">₦{(totalSale || 0).toLocaleString()}</td>

                      <td className="border p-1">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenAddRestock(
                                row.originalItem,
                                row.variantName,
                                row.variantType.toLowerCase()
                              );
                            }}
                            className="px-2 py-1 bg-green-600 text-white rounded text-sm"
                            title="Restock this variant"
                          >
                            Restock
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditClick(e, row.originalItem);
                            }}
                            className="px-2 py-1 bg-blue-500 text-white rounded text-sm"
                            title="Edit product"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>

          {renderFooter()}
        </div>
      </div>

      {/* MODAL */}
      {modalOpen && modalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg w-11/12 max-w-2xl p-6 overflow-y-auto max-h-[80vh]">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-bold">{modalItem.name} - History</h2>
                {modalVariant ? (
                  <p className="text-sm text-gray-600 mt-1">
                    Viewing variant: <b>{modalVariant.variantType}</b> — {modalVariant.variantName} 
                    <span className="font-mono">({modalVariant.variantId})</span>
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  className="text-red-500 font-bold"
                  onClick={closeMainModal}
                >
                  X
                </button>
              </div>
            </div>

            {/* Restock History */}
            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Restock History</h3>
              <table className="w-full border-collapse border border-gray-300">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="border p-1">ID</th>
                    <th className="border p-1">Quantity</th>
                    <th className="border p-1">Admin</th>
                    <th className="border p-1">Shipment Fee</th>
                    <th className="border p-1">Size/Color</th>
                    <th className="border p-1">Timestamp</th>
                    <th className="border p-1">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {modalItem.restockHistory?.map((entry) => (
                    <tr key={entry.id}>
                      <td className="border p-1">{entry.id}</td>
                      <td className="border p-1">{entry.quantity}</td>
                      <td className="border p-1">{entry.adminId}</td>
                      <td className="border p-1">{entry.shipmentFee ?? "-"}</td>
                      <td className="border p-1">
                        {entry.size ?? entry.color ?? entry.variantName ?? "-"}
                      </td>
                      <td className="border p-1">{formatDate(entry.timestamp)}</td>

                      <td className="border p-1 flex gap-2 justify-center">
                        <button
                          type="button"
                          className="p-1"
                          onClick={(e) => handleEditRestock(e, modalItem, entry)}
                          aria-label="Edit restock"
                          title="Edit"
                        >
                          <FaEdit className="text-blue-500" />
                        </button>

                        <button
                          type="button"
                          className="p-1"
                          onClick={(e) => {
                            if (!window.confirm("Delete this restock entry?")) return;
                            handleDeleteRestock(e, modalItem, entry);
                          }}
                          aria-label="Delete restock"
                          title="Delete"
                        >
                          <FaTrash className="text-red-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add Restock Modal (inline small form) */}
            {addRestockOpen && (
              <div className="mb-4 p-3 border rounded bg-gray-50">
                <h4 className="font-semibold mb-2">
                  New Restock for {modalItem.name}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="number"
                    className="border p-2 rounded"
                    placeholder="Quantity"
                    value={newRestock.quantity}
                    onChange={(e) =>
                      setNewRestock((p) => ({
                        ...p,
                        quantity: e.target.value,
                      }))
                    }
                    autoFocus
                  />
                  <input
                    type="text"
                    className="border p-2 rounded"
                    placeholder="Variant name (color or size) — optional"
                    value={newRestock.variant}
                    onChange={(e) =>
                      setNewRestock((p) => ({
                        ...p,
                        variant: e.target.value,
                      }))
                    }
                  />
                  <select
                    className="border p-2 rounded"
                    value={newRestock.variantType}
                    onChange={(e) =>
                      setNewRestock((p) => ({
                        ...p,
                        variantType: e.target.value,
                      }))
                    }
                  >
                    <option value="auto">Auto-detect variant type</option>
                    <option value="color">Color</option>
                    <option value="size">Size</option>
                    <option value="none">No variant (top-level)</option>
                  </select>
                  <input
                    type="text"
                    className="border p-2 rounded"
                    placeholder="Shipment Fee (optional)"
                    value={newRestock.shipmentFee}
                    onChange={(e) =>
                      setNewRestock((p) => ({
                        ...p,
                        shipmentFee: e.target.value,
                      }))
                    }
                  />
                </div>

                <textarea
                  className="w-full border p-2 rounded mt-2"
                  placeholder="Note (optional)"
                  value={newRestock.note}
                  onChange={(e) => setNewRestock((p) => ({ ...p, note: e.target.value }))}
                />

                <div className="flex gap-2 justify-end mt-2">
                  <button
                    className="px-3 py-2 bg-gray-300 rounded"
                    onClick={closeAddRestockForm}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-2 bg-green-600 text-white rounded"
                    onClick={() =>
                      addRestock({
                        productId: newRestock.productId || modalItem.id,
                        quantity: newRestock.quantity,
                        shipmentFee: newRestock.shipmentFee || null,
                        variantName: newRestock.variant?.trim() || "",
                        variantType: newRestock.variantType || "auto",
                        note: newRestock.note || "",
                      })
                    }
                  >
                    Save Restock
                  </button>
                </div>
              </div>
            )}

            {/* Sold History */}
            <div className="mb-4">
              <h3 className="font-semibold text-lg mb-2">Sold History</h3>
              <table className="w-full border-collapse border border-gray-300">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="border p-1">ID</th>
                    <th className="border p-1">Variant ID</th>
                    <th className="border p-1">Variant Type</th>
                    <th className="border p-1">Variant Sold</th>
                    <th className="border p-1">Quantity</th>
                    <th className="border p-1">Timestamp</th>
                    <th className="border p-1">Inventory Count</th>
                    <th className="border p-1">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {modalItem.soldHistory?.map((entry) => (
                    <tr key={entry.id}>
                      <td className="border p-1">{entry.id}</td>
                      <td className="border p-1 font-mono text-xs">
                        {getVariantUniqueId(modalItem.id, getSoldEntryVariantName(entry))}
                      </td>
                      <td className="border p-1">{getSoldEntryVariantType(modalItem, entry)}</td>
                      <td className="border p-1 font-semibold">{getSoldEntryVariantName(entry)}</td>
                      <td className="border p-1">{entry.quantity}</td>
                      <td className="border p-1">{formatDate(entry.timestamp)}</td>
                      <td className="border p-1">
                        {isSoldEntryCounted(entry) ? "Counted" : "Ignored by date"}
                      </td>

                      <td className="border p-1 flex gap-2 justify-center">
                        <button
                          type="button"
                          className="p-1"
                          onClick={(e) => handleEditSold(e, modalItem, entry)}
                          aria-label="Edit sold"
                          title="Edit"
                        >
                          <FaEdit className="text-blue-500" />
                        </button>

                        <button
                          type="button"
                          className="p-1"
                          onClick={(e) => {
                            if (!window.confirm("Delete this sold entry?")) return;
                            handleDeleteSold(e, modalItem, entry);
                          }}
                          aria-label="Delete sold"
                          title="Delete"
                        >
                          <FaTrash className="text-red-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {/* If soldHistory empty, still show a hint of orders-based sold */}
                  {(!modalItem.soldHistory || modalItem.soldHistory.length === 0) && (
                    <tr>
                      <td className="border p-2 text-sm text-gray-600" colSpan={8}>
                        No soldHistory records yet. (Paid orders sold count for this product from {salesStartDateLabel}:{" "}
                        <b>{getSoldFromOrdersForItem(modalItem)}</b>)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-4 text-right">
              <p>
                <strong>Total Restocked:</strong> {sumRestockedForItem(modalItem)}
              </p>
              <p>
                <strong>Total Sold From {salesStartDateLabel} (History/Orders):</strong>{" "}
                {getEffectiveSoldForItem(modalItem)}
              </p>
              <p>
                <strong>Qty Balance:</strong> {getItemBalanceTotal(modalItem)}
              </p>
            </div>
          </div>
        </div>
      )}

      {editSoldOpen && editingSold && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Edit Sold Record</h2>
            <div className="mb-3 text-sm text-gray-700">
              <b>Variant:</b> {editingSold.variantType || "N/A"} — {editingSold.variantName || "-"}
            </div>

            <div className="space-y-3">
              <input
                type="number"
                className="w-full border p-2 rounded"
                placeholder="Quantity Sold"
                value={editingSold.quantity}
                onChange={(e) =>
                  setEditingSold((p) => ({
                    ...p,
                    quantity: Number(e.target.value),
                  }))
                }
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                className="px-4 py-2 bg-gray-300 rounded"
                onClick={closeEditSoldModal}
              >
                Cancel
              </button>

              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={async () => {
                  try {
                    const resolvedProduct =
                      await resolveExistingProductRef(editingSold.productId);
                    const ref = resolvedProduct.ref;
                    const snap = resolvedProduct.snap;

                    if (!ref || !snap?.exists()) {
                      toast.error("Product not found. Reload and try again.");
                      return;
                    }

                    const data = snap.data();
                    const oldEntry = data.soldHistory.find((s) => s.id === editingSold.entryId);

                    const oldQty = oldEntry?.quantity || 0;
                    const newQty = editingSold.quantity || 0;
                    const qtyDiff = oldQty - newQty;

                    let colorsArr = Array.isArray(data.colors) ? data.colors.slice() : [];
                    let sizesArr = Array.isArray(data.sizes) ? data.sizes.slice() : [];

                    const variantName =
                      oldEntry?.variantName || oldEntry?.color || oldEntry?.size || null;

                    if (variantName && qtyDiff !== 0) {
                      const variantLower = variantName.toString().toLowerCase();
                      const inColors = colorsArr.some(
                        (c) =>
                          ((typeof c === "string" ? c : c?.name) || "").toLowerCase() ===
                          variantLower
                      );
                      const inSizes = sizesArr.some(
                        (s) =>
                          ((typeof s === "string" ? s : s?.name) || "").toLowerCase() ===
                          variantLower
                      );

                      if (inColors) {
                        colorsArr = updateVariantInArray(colorsArr, variantName, qtyDiff);
                      } else if (inSizes) {
                        sizesArr = updateVariantInArray(sizesArr, variantName, qtyDiff);
                      } else {
                        colorsArr = updateVariantInArray(colorsArr, variantName, qtyDiff);
                        sizesArr = updateVariantInArray(sizesArr, variantName, qtyDiff);
                      }
                    }

                    await updateDoc(ref, {
                      soldHistory: data.soldHistory.map((s) =>
                        s.id === editingSold.entryId ? { ...s, quantity: newQty } : s
                      ),
                      quantity: increment(qtyDiff),
                      ...(colorsArr ? { colors: colorsArr } : {}),
                      ...(sizesArr ? { sizes: sizesArr } : {}),
                    });

                    const refreshed = await getDoc(ref);
                    if (refreshed.exists()) {
                      setModalItem({ id: refreshed.id, ...refreshed.data() });
                    }

                    toast.success("Sold record updated");
                    setEditSoldOpen(false);
                    setEditingSold(null);
                    setRefreshIndex((i) => i + 1);
                    restorePreviousPosition();
                  } catch (err) {
                    console.error(err);
                    toast.error("Failed to update sold record");
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {editRestockOpen && editingRestock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Edit Restock</h2>

            <div className="space-y-3">
              <input
                type="number"
                className="w-full border p-2 rounded"
                placeholder="Quantity"
                value={editingRestock.quantity}
                onChange={(e) =>
                  setEditingRestock((p) => ({
                    ...p,
                    quantity: Number(e.target.value),
                  }))
                }
              />

              <input
                type="text"
                className="w-full border p-2 rounded"
                placeholder="Shipment Fee"
                value={editingRestock.shipmentFee}
                onChange={(e) =>
                  setEditingRestock((p) => ({
                    ...p,
                    shipmentFee: e.target.value,
                  }))
                }
              />

              <input
                type="text"
                className="w-full border p-2 rounded"
                placeholder="Size / Color"
                value={editingRestock.size}
                onChange={(e) =>
                  setEditingRestock((p) => ({
                    ...p,
                    size: e.target.value,
                  }))
                }
              />

              <input
                type="text"
                className="w-full border p-2 rounded"
                placeholder="Note"
                value={editingRestock.note || ""}
                onChange={(e) =>
                  setEditingRestock((p) => ({
                    ...p,
                    note: e.target.value,
                  }))
                }
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                className="px-4 py-2 bg-gray-300 rounded"
                onClick={closeEditRestockModal}
              >
                Cancel
              </button>

              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={async () => {
                  await saveEditedRestock();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


const renderStatCard = (title, value, color) => (
  <div className={`bg-${color}-500 text-white p-4 rounded-md inline-block m-2`}>
    <div className="text-sm">{title}</div>
    <div className="text-2xl font-bold">{value}</div>
  </div>
);

export default InventoryPage;