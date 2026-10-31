import React, { useEffect } from "react";
import { useMyContext } from "../Context/MyContext";

const UserInformation = () => {
  const { state } = useMyContext();
  const user = state.user;

  // Safely extract fields
  const userName = user?.name || "Guest User";
  const userRole = user?.role || "Regular User";
  const userID = user?.userID ? user.userID.substring(0, 6) : "----";

  useEffect(() => {
    console.log("🧍‍♂️ Updated User in State:", user);
  }, [user]);

  return (
    <div className="flex flex-col items-center bg-white p-4 rounded-2xl shadow-md w-full max-w-xs">
      {/* Circular Avatar */}
      <div className="w-16 h-16 bg-gray-300 rounded-full mb-3 flex items-center justify-center text-xl font-semibold text-white">
        {userName.charAt(0).toUpperCase()}
      </div>

      {/* User Info */}
      <div className="text-center">
        <p className="text-lg font-bold text-gray-800 mb-1">{userName}</p>
        <p className="text-sm text-gray-500 mb-1">{userRole}</p>
        <p className="text-sm text-gray-400">User ID: {userID}...</p>
      </div>
    </div>
  );
};

export default UserInformation;
