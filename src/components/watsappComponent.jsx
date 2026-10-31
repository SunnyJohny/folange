import React from "react";
import { FaWhatsapp } from "react-icons/fa"; // Import WhatsApp icon

const WhatsAppIcon = ({ messageCount = 1 }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="relative">
        <a
          href="https://wa.me/2347033389736" // Business WhatsApp number
          target="_blank"
          rel="noopener noreferrer"
          className="bg-green-500 text-white w-14 h-14 sm:w-12 sm:h-12 flex items-center justify-center rounded-full shadow-lg hover:bg-green-600 transition-transform transform hover:scale-110"
        >
          <FaWhatsapp className="text-3xl sm:text-2xl" />
        </a>

        {/* Badge for message count */}
        {messageCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold h-5 w-5 rounded-full flex items-center justify-center shadow-md">
            {messageCount}
          </span>
        )}
      </div>
    </div>
  );
};

export default WhatsAppIcon;
