import React from "react";
import { useNavigate } from "react-router-dom";

const maskLastTwo = (pw) => {
  if (!pw) return "";
  if (pw.length <= 2) return "•".repeat(pw.length);
  return pw.slice(0, -2) + "••";
};

export default function CredentialsModal({
  show = false,
  email,
  password,
  onClose = () => {},
}) {
  const navigate = useNavigate(); // ✅ Safe to use here (inside Router)

  if (!show) return null;

  const handleContinue = () => {
    onClose(); // close modal first
    navigate("/checkout"); // ✅ smooth navigation without refresh
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 px-4">
      <div className="bg-white p-6 rounded-2xl w-full max-w-sm shadow-lg text-center">
        <h2 className="text-xl font-semibold mb-4 text-gray-800">
          Account Created Successfully 🎉
        </h2>
        <p className="text-gray-700 mb-2">You’re now signed in!</p>
        <p className="text-sm text-gray-600 mb-4">
          Please save your login details for future access:
        </p>
        <div className="bg-gray-100 p-3 rounded-md text-left mb-4">
          <p>
            <strong>Email:</strong> {email}
          </p>
          <p>
            <strong>Password:</strong> {maskLastTwo(password)}
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleContinue}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-semibold transition"
          >
            Continue to Checkout
          </button>
          <button
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-semibold transition"
          >
            Close
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Note: Last two characters of the password are hidden for security.
        </p>
      </div>
    </div>
  );
}
