import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-scroll";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, EffectFade } from "swiper/modules";
import {
  Bot,
  ChevronDown,
  MessageCircle,
  Send,
  ShoppingBag,
  User,
  X,
} from "lucide-react";

import "swiper/css";
import "swiper/css/autoplay";
import "swiper/css/effect-fade";

import { useMyContext } from "../Context/MyContext";

// Replace this placeholder with Folange Beauty Lounge's WhatsApp number
// in international format without the leading "+".
const WHATSAPP_NUMBER = "2348000000000";

const HERO_SLIDES = [
  {
    id: "folange-beauty-hero-1",
    name: "Folange Beauty Lounge",
    image:
      "https://images.unsplash.com/photo-1653784097013-786a8965ea3b?auto=format&fit=crop&w=1800&q=85",
    alt: "Beauty products arranged in a soft, elegant setting",
  },
  {
    id: "folange-beauty-hero-2",
    name: "Skincare Essentials",
    image:
      "https://images.pexels.com/photos/31552021/pexels-photo-31552021/free-photo-of-flat-lay-of-skincare-products-with-pink-aesthetic.jpeg?auto=compress&cs=tinysrgb&w=1800",
    alt: "Skincare and beauty products in a soft aesthetic",
  },
  {
    id: "folange-beauty-hero-3",
    name: "Makeup Collection",
    image:
      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=1800&q=85",
    alt: "Makeup and cosmetic essentials",
  },
  {
    id: "folange-beauty-hero-4",
    name: "Beauty & Makeup",
    image:
      "https://images.unsplash.com/photo-1523634118614-82b2685ee3df?auto=format&fit=crop&w=1800&q=85",
    alt: "Beauty and makeup products displayed together",
  },
  {
    id: "folange-beauty-hero-5",
    name: "Skincare & Personal Care",
    image:
      "https://images.unsplash.com/photo-1566958769312-82cef41d19ef?auto=format&fit=crop&w=1800&q=85",
    alt: "Skincare and personal care products",
  },
];

const Hero = () => {
  const { cookingitems: beautyProducts = [] } = useMyContext();

  const swiperRef = useRef(null);
  const chatBodyRef = useRef(null);
  const inputRef = useRef(null);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  const [message, setMessage] = useState("");
  const [isBotTyping, setIsBotTyping] = useState(false);

  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: "bot",
      text: "Hello! Welcome to Folange Beauty Lounge. I can help you find beauty products, understand delivery, payment, orders and other shopping information.",
      time: new Date(),
      showWhatsApp: false,
    },
  ]);

  // Use curated beauty images for the hero slider.
  // Folange product data from Firestore remains available to the chatbot through MyContext.
  const slides = useMemo(() => HERO_SLIDES, []);

  // Force autoplay to start as soon as the component mounts.
  useEffect(() => {
    if (
      swiperRef.current &&
      swiperRef.current.autoplay &&
      typeof swiperRef.current.autoplay.start === "function"
    ) {
      swiperRef.current.autoplay.start();
    }
  }, [slides.length]);

  // Scroll to the newest chat message.
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTo({
        top: chatBodyRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isBotTyping]);

  // Focus input when chatbot opens.
  useEffect(() => {
    if (isChatOpen) {
      setHasOpenedChat(true);

      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    }
  }, [isChatOpen]);

  const formatMessageTime = (date) => {
    if (!date) return "";

    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const normalizeText = (text) => {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const includesAny = (text, keywords) => {
    return keywords.some((keyword) => text.includes(keyword));
  };

  const getProductName = (product) => {
    return (
      product?.name ||
      product?.title ||
      product?.productName ||
      product?.itemName ||
      "Unnamed product"
    );
  };

  // Support Folange's original and discounted product-price fields.
  const getProductPrice = (product) => {
    const rawPrice = [
      product?.priceDiscounted,
      product?.discountPrice,
      product?.price,
      product?.amount,
      product?.sellingPrice,
      product?.basePrice,
      product?.priceOriginal,
    ].find(
      (value) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
    );

    const numberPrice = Number(String(rawPrice ?? "").replace(/[₦,\s]/g, ""));

    if (!Number.isFinite(numberPrice)) {
      return null;
    }

    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      maximumFractionDigits: 0,
    }).format(numberPrice);
  };

  const getAvailableProducts = () => {
    return beautyProducts.filter((product) => {
      const quantity = Number(
        product?.quantity ??
          product?.stock ??
          product?.availableQuantity ??
          product?.inventory ??
          1
      );

      const explicitlyUnavailable =
        product?.available === false ||
        product?.isAvailable === false ||
        product?.status === "out-of-stock" ||
        product?.status === "unavailable";

      return !explicitlyUnavailable && quantity !== 0;
    });
  };

  const searchProducts = (customerMessage) => {
    const normalizedMessage = normalizeText(customerMessage);

    const ignoredWords = new Set([
      "do",
      "you",
      "have",
      "sell",
      "stock",
      "available",
      "availability",
      "find",
      "show",
      "me",
      "need",
      "want",
      "buy",
      "order",
      "product",
      "products",
      "item",
      "items",
      "please",
      "can",
      "i",
      "is",
      "are",
      "the",
      "a",
      "an",
      "some",
      "any",
      "looking",
      "for",
      "how",
      "much",
      "price",
      "cost",
      "of",
    ]);

    const searchWords = normalizedMessage
      .split(" ")
      .filter((word) => word.length > 2 && !ignoredWords.has(word));

    if (searchWords.length === 0) {
      return [];
    }

    return beautyProducts
      .map((product) => {
        const productText = normalizeText(
          [
            product?.name,
            product?.title,
            product?.productName,
            product?.itemName,
            product?.description,
            product?.category,
            product?.brand,
            product?.keywords,
            Array.isArray(product?.tags) ? product.tags.join(" ") : "",
          ]
            .filter(Boolean)
            .join(" ")
        );

        const score = searchWords.reduce((total, word) => {
          return productText.includes(word) ? total + 1 : total;
        }, 0);

        return {
          product,
          score,
        };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((result) => result.product);
  };

  const createProductResponse = (products) => {
    if (!products.length) {
      return null;
    }

    const productLines = products.map((product, index) => {
      const name = getProductName(product);
      const price = getProductPrice(product);

      return `${index + 1}. ${name}${price ? ` — ${price}` : ""}`;
    });

    return `I found these related beauty products:\n\n${productLines.join(
      "\n"
    )}\n\nScroll to the beauty store section to view them and place your order.`;
  };

  const generateBotResponse = (customerMessage) => {
    const text = normalizeText(customerMessage);

    if (!text) {
      return {
        text: "Please type a question so I can assist you.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "hello",
        "hi",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
      ])
    ) {
      return {
        text: "Hello! Welcome to Folange Beauty Lounge. How can I help you today?",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "who are you",
        "what are you",
        "your name",
        "chatbot",
        "assistant",
      ])
    ) {
      return {
        text: "I am the Folange Beauty Lounge virtual shopping assistant. I can answer common questions about beauty products, orders, payments, delivery and customer support.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "what is folange",
        "about folange",
        "about you",
        "tell me about folange",
      ])
    ) {
      return {
        text: "Folange Beauty Lounge is a beauty store for cosmetics, skincare, body care, hair care, makeup and other beauty essentials. Browse the available products or contact our team for assistance.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "delivery",
        "shipping",
        "ship",
        "dispatch",
        "waybill",
        "send to",
        "deliver to",
      ])
    ) {
      return {
        text: "Folange Beauty Lounge can arrange delivery based on your location. The delivery fee and estimated delivery time are confirmed during checkout or by our customer-support representative.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "how long",
        "delivery time",
        "when will",
        "how many days",
        "arrival",
      ])
    ) {
      return {
        text: "Delivery time depends on your location and the selected product. Local deliveries may arrive sooner, while interstate deliveries may take longer. Contact our WhatsApp support for an exact estimate.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "payment",
        "pay",
        "bank transfer",
        "transfer",
        "card payment",
        "payment method",
        "cash",
      ])
    ) {
      return {
        text: "Available payment instructions will be shown during checkout. Please confirm that you are paying into an official Folange Beauty Lounge payment account before completing any transfer.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "order status",
        "track order",
        "tracking",
        "where is my order",
        "my order",
        "order number",
      ])
    ) {
      return {
        text: "To check an existing order, please contact our WhatsApp support with your order number and the name or phone number used during checkout.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "cancel order",
        "cancel my order",
        "order cancellation",
        "cancel purchase",
      ])
    ) {
      return {
        text: "Order cancellation depends on whether the order has already been processed or dispatched. Contact our WhatsApp support immediately with your order number.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "refund",
        "return",
        "exchange",
        "damaged",
        "wrong item",
        "defective",
        "faulty",
      ])
    ) {
      return {
        text: "For a return, exchange, damaged product or refund request, contact our WhatsApp support with your order number and clear details about the issue.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "location",
        "address",
        "where are you",
        "shop location",
        "office location",
      ])
    ) {
      return {
        text: "Folange Beauty Lounge serves customers through its online beauty store. For pickup availability or physical-location details, please contact our WhatsApp support.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "phone number",
        "contact",
        "customer care",
        "customer service",
        "support",
        "speak to someone",
        "human",
        "agent",
        "representative",
      ])
    ) {
      return {
        text: "You can speak directly with a Folange Beauty Lounge customer-support representative on WhatsApp.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "discount",
        "promo",
        "promotion",
        "coupon",
        "voucher",
        "sale",
      ])
    ) {
      return {
        text: "Available discounts and promotions are normally displayed on the website or announced through Folange Beauty Lounge social-media pages. Our WhatsApp support can also confirm current offers.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "wholesale",
        "bulk",
        "reseller",
        "large quantity",
        "many items",
      ])
    ) {
      return {
        text: "Bulk or wholesale orders may qualify for special arrangements. Send the product name and required quantity to our WhatsApp support for confirmation.",
        showWhatsApp: true,
      };
    }

    if (
      includesAny(text, [
        "create account",
        "register",
        "sign up",
        "signup",
        "login",
        "log in",
        "password",
        "forgot password",
      ])
    ) {
      return {
        text: "Use the account or sign-in option on the Folange Beauty Lounge website. For a forgotten password, select the password-reset option and follow the instructions sent to your email.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "cart",
        "add to cart",
        "checkout",
        "place order",
        "how to order",
        "buy product",
      ])
    ) {
      return {
        text: "Select the product you want, choose any required options, add it to your cart and proceed to checkout. Enter your delivery details, review the order and follow the payment instructions.",
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "thank you",
        "thanks",
        "thank",
        "okay",
        "alright",
        "great",
      ])
    ) {
      return {
        text: "You are welcome. I am here whenever you need help with Folange Beauty Lounge.",
        showWhatsApp: false,
      };
    }

    const matchedProducts = searchProducts(customerMessage);
    const productResponse = createProductResponse(matchedProducts);

    if (productResponse) {
      return {
        text: productResponse,
        showWhatsApp: false,
      };
    }

    if (
      includesAny(text, [
        "products",
        "what do you sell",
        "available items",
        "available products",
        "show products",
        "what is available",
      ])
    ) {
      const availableProducts = getAvailableProducts().slice(0, 5);

      if (availableProducts.length > 0) {
        return {
          text: createProductResponse(availableProducts),
          showWhatsApp: false,
        };
      }

      return {
        text: "Please scroll down to the beauty store section to view the products currently available at Folange Beauty Lounge.",
        showWhatsApp: false,
      };
    }

    return {
      text: "I am sorry, I do not have enough information to answer that question correctly. Please contact a Folange Beauty Lounge customer-support representative on WhatsApp.",
      showWhatsApp: true,
    };
  };

  const addBotResponse = (response) => {
    setIsBotTyping(true);

    window.setTimeout(() => {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: Date.now() + Math.random(),
          sender: "bot",
          text: response.text,
          time: new Date(),
          showWhatsApp: response.showWhatsApp,
        },
      ]);

      setIsBotTyping(false);
    }, 700);
  };

  const handleSendMessage = (customMessage) => {
    const finalMessage = String(customMessage || message).trim();

    if (!finalMessage || isBotTyping) {
      return;
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: Date.now() + Math.random(),
        sender: "user",
        text: finalMessage,
        time: new Date(),
        showWhatsApp: false,
      },
    ]);

    setMessage("");

    const response = generateBotResponse(finalMessage);
    addBotResponse(response);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const openWhatsApp = (customerQuestion = "") => {
    const whatsappMessage = customerQuestion
      ? `Hello Folange Beauty Lounge, I need assistance with this question: ${customerQuestion}`
      : "Hello Folange Beauty Lounge, I need assistance with a beauty product or order.";

    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
      whatsappMessage
    )}`;

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  const getLastCustomerQuestion = () => {
    const userMessages = messages.filter(
      (chatMessage) => chatMessage.sender === "user"
    );

    return userMessages[userMessages.length - 1]?.text || "";
  };

  const quickQuestions = [
    "How do I place an order?",
    "What beauty products are available?",
    "How does delivery work?",
    "Track my order",
  ];

  return (
    <div className="relative" id="home">
      {/* Image Slider */}
      <Swiper
        modules={[Autoplay, EffectFade]}
        spaceBetween={0}
        slidesPerView={1}
        effect="fade"
        fadeEffect={{ crossFade: true }}
        autoplay={{
          delay: 5000,
          disableOnInteraction: false,
          pauseOnMouseEnter: false,
        }}
        speed={1500}
        loop={slides.length > 1}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
        }}
        className="h-96"
      >
        {slides.map((equipment, index) => (
          <SwiperSlide
            key={equipment?.id || equipment?.name || index}
            className="relative group"
          >
            {/* Background Image */}
            <img
              src={equipment?.image}
              alt={equipment?.alt || equipment?.name || "Folange Beauty Lounge beauty products"}
              className="w-full h-full object-cover"
            />

            {/* Dark Overlay */}
            <div className="absolute inset-0 bg-black/40" />

            {/* Overlay Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 z-10">
              {index === 0 ? (
                <div className="relative text-center">
                  <h1 className="text-white text-4xl md:text-6xl font-extrabold mb-4 drop-shadow-lg">
                    Welcome to <br />

                    <span className="text-[#8A6517] font-extrabold tracking-wider drop-shadow-md italic">
                      Folange Beauty Lounge
                    </span>
                  </h1>

                  <p className="text-white text-lg md:text-2xl italic tracking-wide font-medium drop-shadow-md">
                    Discover
                    <span className="text-[#E6D5A9] font-semibold">
                      {" "}
                      Beauty.
                    </span>{" "}
                    Embrace
                    <span className="text-[#E6D5A9] font-semibold">
                      {" "}
                      Care.
                    </span>{" "}
                    Feel
                    <span className="text-[#E6D5A9] font-semibold">
                      {" "}
                      Confident.
                    </span>
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="text-4xl md:text-5xl font-extrabold mb-4 text-white drop-shadow-lg text-center">
                    {equipment?.name}
                  </h2>

                  <Link
                    to="cookingitems"
                    spy={true}
                    smooth={true}
                    offset={-70}
                    duration={500}
                  >
                    <button
                      type="button"
                      className="px-8 py-3 bg-[#8A6517] text-white rounded-full font-semibold shadow-lg hover:bg-[#6F5012] hover:scale-105 transition-all duration-300"
                    >
                      Explore Beauty
                    </button>
                  </Link>
                </>
              )}
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      {/* Floating Chatbot */}
      <div className="fixed bottom-5 right-4 sm:right-6 z-[9999]">
        {/* Chat Window */}
        <div
          className={`absolute bottom-20 right-0 w-[calc(100vw-32px)] sm:w-[380px] max-w-[380px] bg-white rounded-3xl shadow-2xl border border-[#E6D5A9] overflow-hidden origin-bottom-right transition-all duration-300 ${
            isChatOpen
              ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
              : "opacity-0 scale-90 translate-y-4 pointer-events-none"
          }`}
        >
          {/* Chat Header */}
          <div className="relative overflow-hidden bg-gradient-to-r from-[#3F3528] via-[#8A6517] to-[#B08D45] px-4 py-4 text-white">
            <div className="absolute -top-12 -right-10 w-28 h-28 rounded-full bg-white/10" />
            <div className="absolute -bottom-16 -left-12 w-36 h-36 rounded-full bg-[#E6D5A9]/30" />

            <div className="relative flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-white text-[#8A6517] flex items-center justify-center shadow-lg">
                    <Bot size={27} />
                  </div>

                  <span className="absolute bottom-0 right-0 block w-3.5 h-3.5 rounded-full bg-[#8A6517] border-2 border-white" />
                </div>

                <div className="min-w-0">
                  <h3 className="font-bold text-base truncate">
                    Folange Beauty Assistant
                  </h3>

                  <p className="text-xs text-[#F8F0DE] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#8A6517]" />
                    Online and ready to help
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsChatOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Close chatbot"
              >
                <ChevronDown size={22} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={chatBodyRef}
            className="h-[390px] max-h-[55vh] overflow-y-auto bg-[#FCFAF5] px-3 sm:px-4 py-4 space-y-4 scroll-smooth"
          >
            <div className="flex justify-center">
              <span className="text-[11px] text-gray-500 bg-white border border-gray-100 px-3 py-1 rounded-full shadow-sm">
                Folange Beauty Lounge automated customer assistance
              </span>
            </div>

            {messages.map((chatMessage) => {
              const isUser = chatMessage.sender === "user";

              return (
                <div
                  key={chatMessage.id}
                  className={`flex items-end gap-2 ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full bg-[#8A6517] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Bot size={17} />
                    </div>
                  )}

                  <div
                    className={`max-w-[82%] ${
                      isUser ? "items-end" : "items-start"
                    } flex flex-col`}
                  >
                    <div
                      className={`px-4 py-3 text-sm leading-relaxed whitespace-pre-line shadow-sm ${
                        isUser
                          ? "bg-[#8A6517] text-white rounded-2xl rounded-br-md"
                          : "bg-white text-gray-700 border border-gray-100 rounded-2xl rounded-bl-md"
                      }`}
                    >
                      {chatMessage.text}
                    </div>

                    {chatMessage.showWhatsApp && (
                      <button
                        type="button"
                        onClick={() =>
                          openWhatsApp(getLastCustomerQuestion())
                        }
                        className="mt-2 inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-xl shadow-md transition-all hover:-translate-y-0.5"
                      >
                        <MessageCircle size={17} />
                        Chat with us on WhatsApp
                      </button>
                    )}

                    <span className="mt-1 px-1 text-[10px] text-gray-400">
                      {formatMessageTime(chatMessage.time)}
                    </span>
                  </div>

                  {isUser && (
                    <div className="w-8 h-8 rounded-full bg-[#8A6517] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                      <User size={16} />
                    </div>
                  )}
                </div>
              );
            })}

            {isBotTyping && (
              <div className="flex items-end gap-2 justify-start">
                <div className="w-8 h-8 rounded-full bg-[#8A6517] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Bot size={17} />
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Questions */}
          {messages.length <= 2 && (
            <div className="bg-white border-t border-gray-100 px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400 mb-2">
                Quick questions
              </p>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {quickQuestions.map((question) => (
                  <button
                    type="button"
                    key={question}
                    onClick={() => handleSendMessage(question)}
                    disabled={isBotTyping}
                    className="flex-shrink-0 text-xs text-[#8A6517] border border-[#E6D5A9] bg-[#F8F0DE] hover:bg-[#EFE2C6] px-3 py-2 rounded-full transition-colors disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message Input */}
          <div className="bg-white border-t border-gray-100 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 border border-gray-200 rounded-2xl bg-[#FCFAF5] focus-within:border-[#8A6517] focus-within:ring-2 focus-within:ring-[#E6D5A9] transition-all">
                <textarea
                  ref={inputRef}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  maxLength={500}
                  placeholder="Type your question..."
                  className="w-full max-h-24 resize-none bg-transparent text-sm text-gray-800 placeholder:text-gray-400 px-4 py-3 outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={!message.trim() || isBotTyping}
                className="w-11 h-11 flex-shrink-0 rounded-full bg-[#8A6517] hover:bg-[#6F5012] text-white flex items-center justify-center shadow-md transition-all hover:scale-105 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:scale-100"
                aria-label="Send message"
              >
                <Send size={19} />
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 px-1">
              <p className="text-[10px] text-gray-400">
                Press Enter to send
              </p>

              <button
                type="button"
                onClick={() => openWhatsApp(getLastCustomerQuestion())}
                className="text-[11px] text-[#25A957] hover:text-[#1f8c49] font-semibold flex items-center gap-1"
              >
                <MessageCircle size={13} />
                WhatsApp support
              </button>
            </div>
          </div>
        </div>

        {/* Chat Toggle Button */}
        <button
          type="button"
          onClick={() => setIsChatOpen((currentValue) => !currentValue)}
          className="relative ml-auto w-16 h-16 rounded-full bg-gradient-to-br from-[#B08D45] to-[#6F5012] text-white flex items-center justify-center shadow-[0_12px_35px_rgba(138,101,23,0.35)] hover:scale-105 active:scale-95 transition-all duration-300 border-4 border-white"
          aria-label={isChatOpen ? "Close chatbot" : "Open chatbot"}
        >
          {isChatOpen ? (
            <X size={27} />
          ) : (
            <MessageCircle size={29} />
          )}

          {!isChatOpen && !hasOpenedChat && (
            <span className="absolute -top-1 -right-1 min-w-6 h-6 px-1 rounded-full bg-[#8A6517] text-white text-xs font-bold flex items-center justify-center border-2 border-white animate-bounce">
              1
            </span>
          )}

          {!isChatOpen && (
            <span className="absolute inset-0 rounded-full border-2 border-[#8A6517] animate-ping opacity-20 pointer-events-none" />
          )}
        </button>

        {/* Helper Label */}
        {!isChatOpen && (
          <div className="absolute right-0 bottom-[74px] whitespace-nowrap bg-white text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl shadow-lg border border-[#E6D5A9]">
            <span className="inline-flex items-center gap-2">
              <ShoppingBag size={16} className="text-[#8A6517]" />
              Need help? Chat with us
            </span>

            <span className="absolute -bottom-1.5 right-6 w-3 h-3 bg-white border-r border-b border-[#E6D5A9] rotate-45" />
          </div>
        )}
      </div>
    </div>
  );
};

export default Hero;