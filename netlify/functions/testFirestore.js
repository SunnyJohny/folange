import admin from "firebase-admin";

// Initialize Firebase Admin (LOCAL TEST)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

export async function handler() {
  try {
    // Write a test document
    const docRef = await db.collection("firestore_test").add({
      message: "Firestore is working locally",
      createdAt: new Date(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        docId: docRef.id,
      }),
    };
  } catch (error) {
    console.error("Firestore test error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
}
