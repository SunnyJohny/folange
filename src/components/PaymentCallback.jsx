import React, { useEffect, useRef } from "react";
import { toast } from "react-toastify";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";
import Spinner from "./Spinner";
import { useMyContext } from "../Context/MyContext";

// ------------------------------------------------------------
// ✅ CHAREX FIRESTORE TRANSACTION PATH
// ------------------------------------------------------------
// Transactions are stored at:
// charex/main/transactions/{reference}
const getCharexTransactionRef = (reference) => {
  const transactionReference = String(reference || "").trim();

  if (!transactionReference) return null;

  return doc(
    db,
    "charex",
    "main",
    "transactions",
    transactionReference
  );
};

const PaymentCallback = () => {
  const navigate = useNavigate();
  const { clearCart } = useMyContext();

  // Prevent duplicate notifications and redirects.
  const hasHandledPayment = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const reference =
      params.get("reference") ||
      params.get("transaction_ref") ||
      params.get("transactionRef") ||
      params.get("paymentReference");

    // Only proceed when a transaction reference exists.
    if (!reference) {
      navigate("/", { replace: true });
      return undefined;
    }

    const transactionRef = getCharexTransactionRef(reference);

    if (!transactionRef) {
      navigate("/", { replace: true });
      return undefined;
    }

    let unsubscribe = () => {};

    unsubscribe = onSnapshot(
      transactionRef,
      (snapshot) => {
        if (!snapshot.exists() || hasHandledPayment.current) return;

        const transactionData = snapshot.data() || {};

        const paymentStatus = String(
          transactionData?.status ||
            transactionData?.paymentStatus ||
            transactionData?.state ||
            ""
        )
          .trim()
          .toLowerCase();

        const successfulStatuses = [
          "paid",
          "success",
          "successful",
          "succeeded",
          "completed",
          "complete",
        ];

        const failedStatuses = [
          "failed",
          "failure",
          "declined",
          "cancelled",
          "canceled",
          "rejected",
        ];

        if (successfulStatuses.includes(paymentStatus)) {
          hasHandledPayment.current = true;

          toast.success("Payment successful 🎉");
          clearCart();

          unsubscribe();
          navigate("/", { replace: true });
          return;
        }

        if (failedStatuses.includes(paymentStatus)) {
          hasHandledPayment.current = true;

          toast.error("Payment failed ❌");

          unsubscribe();
          navigate("/", { replace: true });
        }
      },
      (error) => {
        console.error("CHAREX payment confirmation error:", error);

        if (hasHandledPayment.current) return;

        hasHandledPayment.current = true;

        toast.error("Unable to confirm payment");
        navigate("/", { replace: true });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [navigate, clearCart]);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center gap-4">
      <Spinner />

      <p className="text-gray-700 font-medium text-sm mt-24">
        Please wait, confirming your CHAREX payment...
      </p>
    </div>
  );
};

export default PaymentCallback;