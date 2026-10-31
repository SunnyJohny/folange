import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMyContext } from "../Context/MyContext";
import { FaTrash, FaMinus, FaPlus, FaHeart, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase";
import "react-toastify/dist/ReactToastify.css";
import ShippingAddress from "./ShippingAddress";

/**
 * ✅ Stock control in cart:
 * - Prevent + from exceeding available stock
 * - Toast user when they hit max
 * - Pre-order items are NOT restricted
 */

const CartItem = ({
  id,
  parentId,
  name,
  price,
  quantity,
  selectedColor,
  selectedSize,
  image,
  status,
  type,
}) => {
  const {
    increaseQuantity,
    decreaseQuantity,
    removeFromCart,
    toggleWishlist,
    wishlist,
    cookingitems = [],
  } = useMyContext();

  // ---------- helpers ----------
  const normalize = (s) =>
    (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "");

  const toastLockRef = useRef(false);

  const toastMaxQty = (max) => {
    if (toastLockRef.current) return;
    toastLockRef.current = true;
    toast.info(`You’ve reached the maximum available quantity (${max}).`);
    setTimeout(() => {
      toastLockRef.current = false;
    }, 900);
  };

  const toastOutOfStock = () => {
    if (toastLockRef.current) return;
    toastLockRef.current = true;
    toast.error("This item is out of stock.");
    setTimeout(() => {
      toastLockRef.current = false;
    }, 900);
  };

  // Match the parent cooking item (cart item id might be variantId)
  const parent =
    cookingitems.find((i) => i.id === (parentId || id)) ||
    cookingitems.find((i) => i.id === id) ||
    null;

  const sumRestockedForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.restockHistory || !Array.isArray(item.restockHistory)) return 0;

    const nameLower = variantName.toString().toLowerCase();

    return item.restockHistory
      .filter((r) => {
        if (!r) return false;
        if (r.color && r.color.toString().toLowerCase() === nameLower) return true;
        if (r.size && r.size.toString().toLowerCase() === nameLower) return true;
        if (r.variantName && r.variantName.toString().toLowerCase() === nameLower)
          return true;
        if (r.note && r.note.toString().toLowerCase().includes(nameLower)) return true;
        return false;
      })
      .reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  };

  const sumSoldForVariant = (item, variantName) => {
    if (!variantName) return 0;
    if (!item?.soldHistory || !Array.isArray(item.soldHistory)) return 0;

    const nameLower = variantName.toString().toLowerCase();

    return item.soldHistory
      .filter((r) => {
        if (!r) return false;
        if (r.color && r.color.toString().toLowerCase() === nameLower) return true;
        if (r.size && r.size.toString().toLowerCase() === nameLower) return true;
        if (r.variantName && r.variantName.toString().toLowerCase() === nameLower)
          return true;
        if (r.note && r.note.toString().toLowerCase().includes(nameLower)) return true;
        return false;
      })
      .reduce((s, e) => s + (Number(e.quantity) || 0), 0);
  };

  // Balance for NON-variant item: TotalRestocked - TotalSold
  const getTopLevelBalance = (item) => {
    if (!item) return 0;

    const totalRestocked = Array.isArray(item.restockHistory)
      ? item.restockHistory.reduce((s, r) => s + (Number(r?.quantity) || 0), 0)
      : null;

    const totalSold = Array.isArray(item.soldHistory)
      ? item.soldHistory.reduce((s, r) => s + (Number(r?.quantity) || 0), 0)
      : null;

    // If histories exist, use diff. Otherwise fallback to item.quantity
    if (totalRestocked !== null || totalSold !== null) {
      const rest = totalRestocked || 0;
      const sold = totalSold || 0;
      return Math.max(0, rest - sold);
    }

    return Math.max(0, Number(item.quantity || 0));
  };

  // Balance for variant: restocked(variant) - sold(variant)
  const getVariantBalance = (item, colorName, sizeName) => {
    if (!item) return 0;

    const hasVariantsFlag =
      (Array.isArray(item?.colors) && item.colors.length > 0) ||
      (Array.isArray(item?.sizes) && item.sizes.length > 0);

    if (!hasVariantsFlag) return getTopLevelBalance(item);

    const variantName =
      (colorName && colorName.toString().trim()) ||
      (sizeName && sizeName.toString().trim()) ||
      null;

    if (!variantName) {
      // no variant chosen in cart → safest fallback: total balance
      return getTopLevelBalance(item);
    }

    const restocked = sumRestockedForVariant(item, variantName);
    const sold = sumSoldForVariant(item, variantName);
    return Math.max(0, restocked - sold);
  };

  const isPreOrder =
    normalize(type) === "preorder" || normalize(status) === "preorder";

  const maxStock = parent
    ? getVariantBalance(parent, selectedColor, selectedSize)
    : 0;

  const variantLabel =
    selectedColor || selectedSize
      ? `Variant: ${selectedColor || ""} ${
          selectedSize ? `| Size: ${selectedSize}` : ""
        }`
      : "";

  const isWished = wishlist?.some((item) => item.id === id);

  return (
    <div className="flex items-start gap-3 border-b pb-4 mb-4">
      <img
        src={image || "/placeholder.png"}
        alt={name}
        className="w-16 h-16 rounded object-cover border"
      />

      <div className="flex-1">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-sm">{name}</h3>

            {/* ✅ Display status below name */}
            {status && (
              <p
                className={`text-xs mt-1 font-semibold ${
                  status === "Available" ? "text-green-600" : "text-yellow-600"
                }`}
              >
                {status === "Available" ? "✅ In Stock" : "🕓 Pre-order"}
              </p>
            )}

            {variantLabel && (
              <p className="text-xs text-gray-500 mt-[2px]">{variantLabel}</p>
            )}

            <p className="text-sm font-medium text-gray-800 mt-[2px]">
              ₦{price.toLocaleString()}
            </p>

            {/* Optional: show max stock for available items */}
            {!isPreOrder && (
              <p className="text-[11px] text-gray-500 mt-1">
                Max available: <span className="font-semibold">{maxStock}</span>
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <FaHeart
              className={`cursor-pointer text-lg ${
                isWished ? "text-purple-600" : "text-gray-400"
              }`}
              onClick={() => toggleWishlist({ id, name, price, image })}
            />
            <FaTrash
              onClick={() => removeFromCart(id, selectedColor, selectedSize)}
              className="text-gray-500 hover:text-purple-700 cursor-pointer text-lg"
            />
          </div>
        </div>

        <div className="flex items-center border rounded mt-3 w-fit">
          <button
            onClick={() => decreaseQuantity(id, selectedColor, selectedSize)}
            className="px-2 text-gray-600 hover:text-purple-600"
          >
            <FaMinus />
          </button>

          <span className="px-3 text-sm">{quantity}</span>

          <button
            onClick={() => {
              // ✅ Allow preorders without restriction
              if (isPreOrder) {
                increaseQuantity(id);
                return;
              }

              // ✅ If parent not found, allow but don't hard-break
              if (!parent) {
                increaseQuantity(id);
                return;
              }

              // ✅ If stock is 0 → block
              if (maxStock <= 0) {
                toastOutOfStock();
                return;
              }

              // ✅ If at max → toast and block
              if (quantity >= maxStock) {
                toastMaxQty(maxStock);
                return;
              }

              increaseQuantity(id);
            }}
            className="px-2 text-gray-600 hover:text-green-500"
          >
            <FaPlus />
          </button>
        </div>

        <p className="font-semibold text-sm mt-2">
          ₦{(price * quantity).toLocaleString()}
        </p>
      </div>
    </div>
  );
};

const Cart = () => {
  const navigate = useNavigate();

  const {
    cart,
    toggleCart,
    isCartOpen,
    clearCart,
    currentUser,
    setShowSignInModal,
  } = useMyContext();

  const [showShippingModal, setShowShippingModal] = useState(false);
  const [orderModal, setOrderModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [uploading, setUploading] = useState(false);

  const overallTotal = cart.reduce(
    (acc, item) => acc + item.price * item.quantity,
    0
  );

  // ✅ Upload receipt handler and create order
  const handleUploadReceipt = async () => {
    if (!receipt) {
      toast.error("Please select a receipt file.");
      return;
    }

    if (!currentUser) {
      toast.error("Please sign in first.");
      setShowSignInModal(true);
      return;
    }

    setUploading(true);
    try {
      // Upload receipt to Firebase Storage
      const filePath = `receipts/${Date.now()}_${receipt.name}`;
      const storageRef = ref(storage, filePath);
      await uploadBytesResumable(storageRef, receipt);
      const receiptUrl = await getDownloadURL(storageRef);

      // Generate unique order ID
      const orderId = `ORD-${Date.now()}`;

      // Create order object
      const orderData = {
        orderId,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        userName: currentUser.displayName || "Unknown User",

        // ✅ FIX: do NOT store null variant fields in Firestore
        items: cart.map((item) => ({
          id: item.id,
          parentId: item.parentId || item.id, // optional but useful
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          image: item.image || "",
          category: item.category || "",
          type: item.type || "available",

          ...(item.selectedColor ? { selectedColor: item.selectedColor } : {}),
          ...(item.selectedSize ? { selectedSize: item.selectedSize } : {}),

          // optional: if you store these in cart items
          ...(item.variants ? { variants: item.variants } : {}),
          ...(item.variantText ? { variantText: item.variantText } : {}),
        })),

        totalAmount: overallTotal,
        shipmentFee: cart[0]?.shipmentFee || 0,
        grandTotal:
          overallTotal +
          cart.reduce(
            (sum, item) =>
              sum + (item.shipmentFee || 0) * (item.quantity || 1),
            0
          ),

        paymentMethod,
        receiptUrl,
        orderStatus: "Pending Confirmation",
        orderType: cart.some((i) => i.type === "preorder")
          ? "preorder"
          : "available",
        address: currentUser.address || "Not Provided",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Save order to Firestore
      await addDoc(collection(db, "orders"), orderData);

      toast.success("Order created successfully!");
      clearCart();
      toggleCart();
      setOrderModal(false);
      setReceipt(null);
    } catch (err) {
      console.error(err);
      toast.error("Error submitting order.");
    } finally {
      setUploading(false);
    }
  };

  if (!isCartOpen) return null;

  return (
    <div
      className={`fixed top-0 right-0 w-full sm:w-[400px] h-full bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ${
        isCartOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b shadow-sm">
        <h2 className="text-xl font-bold">
          My Cart{" "}
          <span className="text-gray-500 text-sm font-normal ml-1">
            Cart Page
          </span>
        </h2>
        <button onClick={toggleCart}>
          <FaTimes className="text-2xl text-gray-600 hover:text-purple-600" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {cart.length > 0 ? (
          <>
            {cart.map((item, i) => (
              <CartItem key={i} {...item} />
            ))}

            {/* Totals */}
            <div className="mt-6 border-t pt-4">
              <p className="text-base font-semibold flex justify-between">
                <span>Subtotal:</span>
                <span>₦{overallTotal.toLocaleString()}</span>
              </p>

              <p className="text-base font-semibold flex justify-between mt-2 text-gray-700">
                <span>Shipment Fee:</span>
                <span>
                  ₦
                  {cart.length > 0
                    ? cart
                        .reduce(
                          (sum, item) =>
                            sum +
                            (item.shipmentFee || 0) * (item.quantity || 1),
                          0
                        )
                        .toLocaleString()
                    : "—"}
                </span>
              </p>

              <p className="text-base font-semibold flex justify-between mt-2">
                <span>Total (excluding shipment):</span>
                <span>₦{overallTotal.toLocaleString()}</span>
              </p>
            </div>

            {/* Checkout & Clear Cart Buttons */}
            {cart.length > 0 && (
              <div className="p-4 border-t bg-white shadow-inner flex gap-3">
                <button
                  onClick={() => {
                    if (
                      window.confirm("Are you sure you want to clear your cart?")
                    ) {
                      clearCart();
                      toast.info("🧹 Cart cleared successfully!");
                    }
                  }}
                  className="flex-1 border border-purple-600 text-purple-600 font-semibold py-3 rounded-lg hover:bg-purple-50 transition"
                >
                  Clear Cart
                </button>

                <button
                  onClick={() => {
                    toggleCart();
                    navigate("/checkout");
                  }}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition"
                >
                  Proceed to Checkout
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-center text-gray-500 mt-6">Your cart is empty.</p>
        )}
      </div>

      {/* Order Modal */}
      {orderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white p-6 rounded shadow-lg w-full max-w-md mx-3">
            <h3 className="text-xl font-bold mb-4">Place Order</h3>

            <div className="mb-3">
              <p className="mb-2 font-medium">Select payment method:</p>
              <div className="flex gap-4">
                <label>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="bank"
                    checked={paymentMethod === "bank"}
                    onChange={() => setPaymentMethod("bank")}
                  />
                  <span className="ml-2">Bank Transfer</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="paystack"
                    checked={paymentMethod === "paystack"}
                    onChange={() => setPaymentMethod("paystack")}
                  />
                  <span className="ml-2">Paystack</span>
                </label>
              </div>
            </div>

            {(paymentMethod === "bank" || paymentMethod === "paystack") && (
              <div className="mb-4">
                <label className="block mb-2 font-semibold">
                  Upload Payment Receipt:
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReceipt(e.target.files[0])}
                  className="w-full border p-2 rounded"
                  disabled={uploading}
                />
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setOrderModal(false)}
                className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
                disabled={uploading}
              >
                Cancel
              </button>
              {(paymentMethod === "bank" || paymentMethod === "paystack") && (
                <button
                  onClick={handleUploadReceipt}
                  className={`bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 ${
                    uploading ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                  disabled={uploading || !receipt}
                >
                  {uploading ? "Uploading..." : "Upload & Complete"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shipping Address Modal */}
      {showShippingModal && (
        <ShippingAddress
          user={currentUser}
          onClose={() => setShowShippingModal(false)}
          onSuccess={() => {
            setShowShippingModal(false);
            setOrderModal(true);
          }}
        />
      )}
    </div>
  );
};

export default Cart;