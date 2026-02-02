
import mongoose from "mongoose";
import Product from "./models/product.model.js";
import dotenv from "dotenv";

dotenv.config();

const checkLastProduct = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/electro-ecommerce"); // Fallback to local if env missing, but user usually has env loaded in app
        // Actually we need the connection string. I'll try to guess or use the model if I can load the app context.
        // Simpler: assume the user has a local or atlas URI.
        // If I can't connect, I can't debug.
        // Let's rely on the existing codebase files.

        // BETTER IDEA: Create a temporary route in a new file that I can hit via browser/curl? 
        // No, I can't invoke curl easily.

        // I will write a script that imports the app content? No too complex.

        // Let's just create a standalone script.

        const product = await Product.findOne().sort({ createdAt: -1 }).populate("categories");
        console.log("LAST CREATED PRODUCT:");
        console.log(JSON.stringify(product, null, 2));

        if (product) {
            console.log("Categories Strings:", product.categories.map(c => c._id.toString()));
        }

        process.exit();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

checkLastProduct();
