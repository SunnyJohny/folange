import React, { useState, useEffect } from "react";
import { FaMoneyBillWave, FaWhatsapp, FaClock } from "react-icons/fa";
import { useMyContext } from "../Context/MyContext";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

const PaymentPage = () => {
  const { cart, currentUser } = useMyContext();
  const navigate = useNavigate();
  const [isPaid, setIsPaid] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // ✅ Calculate total amount
  const totalAmount = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  useEffect(() => {
    if (cart.length === 0) {
      navigate("/cart");
    }
  }, [cart, navigate]);

  // ✅ Save note separately
  const handleSaveNote = async () => {
    if (note.trim() === "") {
      alert("Please enter a note before saving.");
      return;
    }

    setSavingNote(true);
    try {
      await addDoc(collection(db, "Notes"), {
        note,
        userId: currentUser?.uid || "guest",
        userEmail: currentUser?.email || "anonymous",
        timestamp: serverTimestamp(),
      });
      alert("Note saved successfully!");
      setNote("");
    } catch (error) {
      console.error("Error saving note:", error);
      alert("Error saving note. Please try again.");
    }
    setSavingNote(false);
  };

  // ✅ Handle payment confirmation (no note saving here)
  const handlePaymentConfirm = async () => {
    setIsVerifying(true);
    setTimeout(() => {
      setIsPaid(true);
      setIsVerifying(false);
    }, 4000); // simulate verification delay
  };

  return (
    <div className="min-h-screen bg-gray-50 flex justify-center py-20 px-4 overflow-y-auto">
      <div className="bg-white shadow-xl rounded-2xl p-8 w-full max-w-lg text-center">
        {/* ================= Before Payment ================= */}
        {!isPaid && !isVerifying && (
          <>
            <h2 className="text-2xl font-bold text-gray-800 mb-3">
              Complete Your Payment
            </h2>
            <p className="text-gray-600 mb-6">
              Please transfer the exact amount below to our UBA account.
            </p>

            {/* ✅ Account Details Section */}
            <div className="border rounded-xl p-5 bg-gray-50 mb-6 text-left">
              <h3 className="font-semibold text-lg text-gray-800 mb-2">
                Bank Transfer Details
              </h3>
              <p className="text-gray-700">
                <strong>Bank:</strong> UBA Bank
              </p>
              <p className="text-gray-700">
                <strong>Account Name:</strong> ImportWithBliss
              </p>
              <p className="text-gray-700">
                {/* <strong>Account Number:</strong> 1234567890 */}
              </p>
              <p className="text-gray-700 mt-3">
                <strong>Amount to Pay:</strong>{" "}
                <span className="text-red-500 font-semibold">
                  ₦{totalAmount.toLocaleString()}
                </span>
              </p>
            </div>

            {/* ✅ Payment Confirmation Button (immediately below account details) */}
            <button
              onClick={handlePaymentConfirm}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold px-6 py-3 rounded-lg transition w-full mb-6"
            >
              {/* I Have Made the Payment */}
            </button>

            {/* ✅ Separate Note Section */}
            <div className="text-left">
              <label
                htmlFor="note"
                className="block text-gray-700 font-medium mb-2"
              >
                Note for the Merchant
              </label>
              <textarea
                id="note"
                rows="3"
                className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-400 outline-none"
                placeholder="Add any special instruction or note..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              ></textarea>

              <button
                onClick={handleSaveNote}
                disabled={savingNote}
                className={`mt-3 bg-gray-700 hover:bg-gray-800 text-white font-semibold px-6 py-2 rounded-lg transition ${
                  savingNote ? "opacity-70 cursor-not-allowed" : ""
                }`}
              >
                {savingNote ? "Saving..." : "Add Note"}
              </button>
            </div>
          </>
        )}

        {/* ================= Verifying Payment ================= */}
        {isVerifying && (
          <div className="flex flex-col items-center">
            <FaClock className="text-5xl text-yellow-500 mb-3 animate-spin-slow" />
            <h3 className="text-xl font-semibold mb-2">Verifying Payment...</h3>
            <p className="text-gray-600">Please wait a moment.</p>
          </div>
        )}

        {/* ================= Payment Complete ================= */}
        {isPaid && (
          <>
            <h3 className="text-2xl font-bold text-green-600 mb-3">
              Payment Received 🎉
            </h3>
            <p className="text-gray-700 mb-6">
              Thank you! Please send your payment receipt via WhatsApp for
              confirmation.
            </p>

            <a
              href={`https://wa.me/2348012345678?text=Hello%20B10%20Eatery!%20I%20just%20paid%20₦${totalAmount.toLocaleString()}%20for%20my%20order.%20Here%20is%20my%20receipt.`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold w-full transition"
            >
              <FaWhatsapp className="text-xl" />
              Send Receipt via WhatsApp
            </a>
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentPage;
