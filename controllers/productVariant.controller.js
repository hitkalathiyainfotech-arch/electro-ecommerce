import mongoose from "mongoose";
import ProductVariant from "../models/productVarient.model.js";
import Product from "../models/product.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { ThrowError } from "../utils/Error.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

const generateSKU = () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const prefix = letters.charAt(Math.floor(Math.random() * letters.length)) +
        letters.charAt(Math.floor(Math.random() * letters.length));
    const number = Math.floor(100000 + Math.random() * 900000);
    return `${prefix}-${number}`;
};

export const createProductVariant = async (req, res) => {
    try {
        const {
            productId,
            variantTitle,
            variantDescription,
            colorName,
            emi,
            overview,
            key_features,
            specification
        } = req.body;

        const userId = req.user?._id;
        const userRole = req.user?.role;
        const images = req.files;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return sendBadRequestResponse(res, "Invalid or missing user ID.");
        }

        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            return sendBadRequestResponse(res, "Invalid product ID.");
        }

        const product = await Product.findById(productId);
        if (!product) return sendNotFoundResponse(res, "Product not found.");

        if (userRole === "seller" && String(product.sellerId) !== String(userId)) {
            return sendBadRequestResponse(res, "Unauthorized access.");
        }

        if (!colorName) {
            return sendBadRequestResponse(res, "colorName is required.");
        }

        if (!variantTitle) {
            return sendBadRequestResponse(res, "variantTitle is required.");
        }

        if (!variantDescription) {
            return sendBadRequestResponse(res, "variantDescription is required.");
        }

        let parsedSizes = [];
        let colorStock = 0;
        let colorPrice = 0;
        let colorDiscountedPrice = null;

        const sizes = req.body.sizes ?
            (typeof req.body.sizes === 'string' ? JSON.parse(req.body.sizes) : req.body.sizes) :
            [];

        if (Array.isArray(sizes) && sizes.length > 0) {
            for (const s of sizes) {
                if (!s.sizeValue || s.sizeValue.trim() === "") continue;

                if (s.stock == null || isNaN(Number(s.stock))) {
                    return sendBadRequestResponse(res, "Each size must include valid stock.");
                }
                if (s.price == null || isNaN(Number(s.price))) {
                    return sendBadRequestResponse(res, "Each size must include valid price.");
                }
                if (s.discountedPrice == null || isNaN(Number(s.discountedPrice))) {
                    return sendBadRequestResponse(res, "Each size must include valid discountedPrice.");
                }

                parsedSizes.push({
                    sizeValue: String(s.sizeValue),
                    price: Number(s.price),
                    discountedPrice: Number(s.discountedPrice),
                    stock: Number(s.stock),
                });
            }
        } else {
            if (req.body.stock == null || isNaN(Number(req.body.stock))) {
                return sendBadRequestResponse(res, "stock is required when sizes not provided");
            }
            if (req.body.price == null || isNaN(Number(req.body.price))) {
                return sendBadRequestResponse(res, "price is required when sizes not provided");
            }

            colorStock = Number(req.body.stock);
            colorPrice = Number(req.body.price);
            colorDiscountedPrice = req.body.discountedPrice ? Number(req.body.discountedPrice) : null;
        }

        const finalSKU = generateSKU();

        let uploadedImages = [];
        if (images && images.length > 0) {
            for (const file of images) {
                const imageUrl = await uploadToS3(file, "productVariant-images");
                uploadedImages.push(imageUrl);
            }
        }

        let parsedKeyFeatures = [];
        if (key_features) {
            try {
                let parsed = typeof key_features === 'string'
                    ? JSON.parse(key_features)
                    : key_features;

                if (!Array.isArray(parsed)) {
                    return sendBadRequestResponse(res, "key_features must be an array");
                }

                parsedKeyFeatures = parsed.map(item => {
                    if (!item.title || typeof item.title !== 'string') {
                        throw new Error("Each key feature must have a title string");
                    }

                    return {
                        title: item.title.trim(),
                        description: item.description ? String(item.description) : ""
                    };
                });
            } catch (error) {
                return sendBadRequestResponse(res, `Invalid key_features format: ${error.message}`);
            }
        }

        const colorObject = {
            colorName,
            images: uploadedImages,
            stock: colorStock,
            price: colorPrice,
            discountedPrice: colorDiscountedPrice,
            sizes: parsedSizes,
        };

        const newVariant = await ProductVariant.create({
            productId,
            sellerId: product.sellerId,
            sku: finalSKU,
            variantTitle,
            variantDescription,
            emi: emi === 'true' || emi === true,
            color: colorObject,
            overview: overview ? (typeof overview === 'string' ? JSON.parse(overview) : overview) : [],
            key_features: parsedKeyFeatures,
            specification: specification ? (typeof specification === 'string' ? JSON.parse(specification) : specification) : [],
        });

        await Product.findByIdAndUpdate(
            productId,
            { $push: { variantId: newVariant._id } },
            { new: true, runValidators: true }
        );

        const populated = await ProductVariant.findById(newVariant._id)
            .populate("productId", "title brand categories")
            .populate("sellerId", "firstName lastName shopName");

        return sendSuccessResponse(res, "Product Variant created successfully.", populated);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const getAllProductVariant = async (req, res) => {
    try {
        const productVarients = await ProductVariant.find({})
            .populate({
                path: "productId",
                populate: [
                    { path: "brand", select: "brandName brandImage" },
                    { path: "categories", select: "name image" }
                ],
            })
            .populate("sellerId", "firstName lastName shopName");

        return sendSuccessResponse(res, "Product Variants fetched successfully", productVarients || []);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
}

export const getSellerProductVarient = async (req, res) => {
    try {
        const user = req.user;

        const variants = await ProductVariant.find({ sellerId: user._id })
            .populate({
                path: "productId",
                select: "title brand categories description rating view sold isActive",
                populate: [
                    { path: "brand", select: "brandName" },
                    { path: "categories", select: "name" }
                ]
            })
            .populate("sellerId", "firstName lastName shopName")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            message: `Your product variants fetched successfully (${user.role})`,
            role: user.role,
            length: variants.length,
            data: variants
        });
    } catch (error) {
        console.error("Error in getSellerProductVarient:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};

export const getProductVarientById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid Product Variant ID");
        }

        const variant = await ProductVariant.findById(id)
            .populate({
                path: "productId",
                populate: [
                    { path: "brand", select: "brandName brandImage" },
                    { path: "categories", select: "name image" }
                ],
            })
            .populate("sellerId", "firstName lastName shopName");

        if (!variant) {
            return sendNotFoundResponse(res, "Product Variant Not Found");
        }

        return sendSuccessResponse(res, "Product Variant fetched successfully", variant);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const updateProductVariant = async (req, res) => {
    try {
        const { variantId } = req.params;
        const {
            variantTitle,
            variantDescription,
            colorName,
            emi,
            overview,
            key_features,
            specification,
            sizes,
            stock,
            price,
            discountedPrice
        } = req.body;

        const userId = req.user?._id;
        const userRole = req.user?.role;

        if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
            return sendBadRequestResponse(res, "Invalid variant ID.");
        }

        const variant = await ProductVariant.findById(variantId);
        if (!variant) return sendNotFoundResponse(res, "Product Variant not found.");

        if (userRole === "seller" && String(variant.sellerId) !== String(userId)) {
            return sendBadRequestResponse(res, "Unauthorized access.");
        }

        const updateData = {};

        if (variantTitle) updateData.variantTitle = variantTitle;
        if (variantDescription) updateData.variantDescription = variantDescription;
        if (emi !== undefined) updateData.emi = emi === 'true' || emi === true;

        if (overview !== undefined) {
            try {
                const parsedOverview = typeof overview === 'string' ? JSON.parse(overview) : overview;
                if (!Array.isArray(parsedOverview)) {
                    return sendBadRequestResponse(res, "overview must be an array");
                }
                updateData.overview = parsedOverview;
            } catch (error) {
                return sendBadRequestResponse(res, "Invalid overview format");
            }
        }

        if (key_features !== undefined) {
            try {
                let parsed = typeof key_features === 'string' ? JSON.parse(key_features) : key_features;

                if (!Array.isArray(parsed)) {
                    return sendBadRequestResponse(res, "key_features must be an array");
                }

                const validatedKeyFeatures = parsed.map(item => {
                    if (!item.title || typeof item.title !== 'string') {
                        throw new Error("Each key feature must have a title string");
                    }

                    return {
                        title: item.title.trim(),
                        description: item.description ? String(item.description) : ""
                    };
                });

                updateData.key_features = validatedKeyFeatures;
            } catch (error) {
                return sendBadRequestResponse(res, `Invalid key_features format: ${error.message}`);
            }
        }

        if (specification !== undefined) {
            try {
                const parsedSpec = typeof specification === 'string' ? JSON.parse(specification) : specification;
                if (!Array.isArray(parsedSpec)) {
                    return sendBadRequestResponse(res, "specification must be an array");
                }
                updateData.specification = parsedSpec;
            } catch (error) {
                return sendBadRequestResponse(res, "Invalid specification format");
            }
        }

        let colorUpdate = { ...variant.color.toObject() };

        if (colorName) colorUpdate.colorName = colorName;

        if (sizes !== undefined) {
            try {
                const sizesInput = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;

                if (Array.isArray(sizesInput)) {
                    if (sizesInput.length > 0) {
                        const validatedSizes = sizesInput.map(s => {
                            if (!s.sizeValue || s.sizeValue.trim() === "") {
                                throw new Error("Size must have a sizeValue");
                            }
                            if (s.stock == null || isNaN(Number(s.stock))) {
                                throw new Error("Each size must include valid stock");
                            }
                            if (s.price == null || isNaN(Number(s.price))) {
                                throw new Error("Each size must include valid price");
                            }

                            return {
                                sizeValue: String(s.sizeValue),
                                stock: Number(s.stock),
                                price: Number(s.price),
                                discountedPrice: s.discountedPrice && !isNaN(Number(s.discountedPrice))
                                    ? Number(s.discountedPrice)
                                    : null
                            };
                        });

                        colorUpdate.sizes = validatedSizes;
                        colorUpdate.stock = 0;
                        colorUpdate.price = 0;
                        colorUpdate.discountedPrice = null;
                    } else {
                        colorUpdate.sizes = [];
                        if (stock == null || isNaN(Number(stock))) {
                            return sendBadRequestResponse(res, "stock is required when sizes not provided");
                        }
                        if (price == null || isNaN(Number(price))) {
                            return sendBadRequestResponse(res, "price is required when sizes not provided");
                        }
                        colorUpdate.stock = Number(stock);
                        colorUpdate.price = Number(price);
                        colorUpdate.discountedPrice = discountedPrice && !isNaN(Number(discountedPrice))
                            ? Number(discountedPrice)
                            : null;
                    }
                } else {
                    return sendBadRequestResponse(res, "sizes must be an array");
                }
            } catch (error) {
                return sendBadRequestResponse(res, `Invalid sizes format: ${error.message}`);
            }
        } else if (stock !== undefined || price !== undefined || discountedPrice !== undefined) {
            if (stock !== undefined) {
                if (isNaN(Number(stock))) {
                    return sendBadRequestResponse(res, "stock must be a valid number");
                }
                colorUpdate.stock = Number(stock);
            }
            if (price !== undefined) {
                if (isNaN(Number(price))) {
                    return sendBadRequestResponse(res, "price must be a valid number");
                }
                colorUpdate.price = Number(price);
            }
            if (discountedPrice !== undefined) {
                colorUpdate.discountedPrice = discountedPrice && !isNaN(Number(discountedPrice))
                    ? Number(discountedPrice)
                    : null;
            }
        }

        if (req.files && req.files.length > 0) {
            if (colorUpdate.images && colorUpdate.images.length > 0) {
                for (const oldImgUrl of colorUpdate.images) {
                    try {
                        if (oldImgUrl && oldImgUrl.includes("amazonaws.com/")) {
                            const encodedKey = oldImgUrl.split("amazonaws.com/")[1];
                            const decodedKey = decodeURIComponent(encodedKey);
                            await deleteFromS3(decodedKey);
                        }
                    } catch (error) {
                        console.log("   Error deleting:", error.message);
                    }
                }
            }

            const uploadedImages = [];
            for (const img of req.files) {
                const imageUrl = await uploadToS3(img, "productVariant-images");
                uploadedImages.push(imageUrl);
            }

            colorUpdate.images = uploadedImages;
        } else {
            console.log("3. No new images, keeping existing ones");
        }

        updateData.color = colorUpdate;

        const updatedVariant = await ProductVariant.findByIdAndUpdate(
            variantId,
            updateData,
            { new: true, runValidators: true }
        )
            .populate("productId", "title brand categories")
            .populate("sellerId", "firstName lastName shopName");

        return sendSuccessResponse(res, "Product Variant updated successfully.", updatedVariant);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const deleteProductVariant = async (req, res) => {
    try {
        const { variantId } = req.params;
        const userId = req.user?._id;
        const userRole = req.user?.role;

        if (!mongoose.Types.ObjectId.isValid(variantId)) {
            return sendBadRequestResponse(res, "Invalid product variant ID");
        }

        const variant = await ProductVariant.findById(variantId);
        if (!variant) return sendNotFoundResponse(res, "Product variant not found");

        if (userRole === 'seller' && variant.sellerId.toString() !== userId.toString()) {
            return sendBadRequestResponse(res, "You can only delete your own product variants");
        }

        if (userRole !== 'admin' && userRole !== 'seller') {
            return sendBadRequestResponse(res, "Unauthorized access");
        }

        if (variant.color?.images && variant.color.images.length > 0) {
            for (const imgUrl of variant.color.images) {
                try {
                    if (imgUrl && imgUrl.includes("amazonaws.com/")) {
                        const encodedKey = imgUrl.split("amazonaws.com/")[1];
                        const decodedKey = decodeURIComponent(encodedKey);
                        await deleteFromS3(decodedKey);
                    }
                } catch (error) {
                    console.log("Error deleting image from S3:", error.message);
                }
            }
        }

        await Product.findByIdAndUpdate(
            variant.productId,
            { $pull: { variantId: variantId } },
            { new: true }
        );

        // Delete variant from database
        await ProductVariant.findByIdAndDelete(variantId);

        const message = userRole === 'admin'
            ? "Product variant deleted successfully by admin"
            : "Product variant deleted successfully";

        return sendSuccessResponse(res, message, variant);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const getProductWiseProductVarientdata = async (req, res) => {
    try {
        const { productId } = req.params;

        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            return sendBadRequestResponse(res, "Valid productId is required!");
        }

        const product = await Product.findById(productId)
            .select("title brand categories description sellerId status")
            .populate("brand", "brandName")
            .populate("categories", "name")
            .populate("sellerId", "firstName lastName shopName");

        if (!product) {
            return sendNotFoundResponse(res, "Product not found!");
        }

        const variants = await ProductVariant.find({ productId })
            .select("variantTitle variantDescription color emi overview key_features specification sku createdAt updatedAt")
            .sort({ createdAt: -1 });

        const formattedVariants = variants.map(variant => {
            const color = variant.color || {};
            const sizes = color.sizes || [];

            let price = { original: 0, discounted: 0, discountPercent: 0 };
            let availableStock = 0;
            let minPrice = Infinity;
            let maxPrice = 0;
            let availableSizes = [];

            if (sizes.length > 0) {
                sizes.forEach(size => {
                    availableStock += size.stock || 0;

                    const sizePrice = size.price || 0;
                    const sizeDiscounted = size.discountedPrice || sizePrice;

                    minPrice = Math.min(minPrice, sizeDiscounted);
                    maxPrice = Math.max(maxPrice, sizeDiscounted);

                    if (size.stock > 0) {
                        availableSizes.push({
                            sizeValue: size.sizeValue,
                            price: size.price,
                            discountedPrice: size.discountedPrice,
                            stock: size.stock
                        });
                    }
                });

                const firstAvailableSize = sizes.find(s => s.stock > 0) || sizes[0] || {};
                price.original = firstAvailableSize.price || 0;
                price.discounted = firstAvailableSize.discountedPrice || firstAvailableSize.price || 0;

                if (price.original > 0 && price.discounted < price.original) {
                    price.discountPercent = Math.round(((price.original - price.discounted) / price.original) * 100);
                }
            } else {
                availableStock = color.stock || 0;
                price.original = color.price || 0;
                price.discounted = color.discountedPrice || color.price || 0;
                minPrice = price.discounted;
                maxPrice = price.discounted;

                if (price.original > 0 && price.discounted < price.original) {
                    price.discountPercent = Math.round(((price.original - price.discounted) / price.original) * 100);
                }
            }

            const inStock = availableStock > 0;

            return {
                _id: variant._id,
                variantTitle: variant.variantTitle,
                variantDescription: variant.variantDescription,
                color: {
                    colorName: color.colorName,
                    images: color.images || [],
                    stock: availableStock,
                    price: price,
                    sizes: availableSizes,
                    inStock: inStock
                },
                emi: variant.emi || false,
                overview: variant.overview || [],
                key_features: variant.key_features || [],
                specification: variant.specification || [],
                sku: variant.sku,
                createdAt: variant.createdAt,
                updatedAt: variant.updatedAt,
                price: price,
                stock: availableStock,
                inStock: inStock,
                priceRange: sizes.length > 1 ? { min: minPrice, max: maxPrice } : null,
                hasSizes: sizes.length > 0
            };
        });

        const totalVariants = variants.length;
        const totalStock = formattedVariants.reduce((sum, variant) => sum + variant.stock, 0);
        const inStockVariants = formattedVariants.filter(v => v.inStock).length;
        const minProductPrice = Math.min(...formattedVariants.map(v => v.price.discounted).filter(p => p > 0));
        const maxProductPrice = Math.max(...formattedVariants.map(v => v.price.discounted));

        return sendSuccessResponse(res, "Product with variants fetched successfully!", {
            product: {
                _id: product._id,
                title: product.title,
                brand: product.brand,
                categories: product.categories,
                description: product.description,
                seller: product.sellerId,
                status: product.status,
                stats: {
                    totalVariants,
                    totalStock,
                    inStockVariants,
                    outOfStockVariants: totalVariants - inStockVariants,
                    priceRange: minProductPrice !== Infinity ? {
                        min: minProductPrice,
                        max: maxProductPrice
                    } : null
                }
            },
            variants: formattedVariants,
            pagination: {
                total: totalVariants,
                page: 1,
                limit: formattedVariants.length
            }
        });
    } catch (error) {
        console.error("Error in getProductWiseProductVarientdata:", error);
        return sendErrorResponse(res, 500, error.message);
    }
};

export const getVariantStockInfo = async (req, res) => {
    try {
        const { variantId } = req.params;

        if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
            return sendBadRequestResponse(res, "Valid variantId is required!");
        }

        const variant = await ProductVariant.findById(variantId)
            .select("color sku variantTitle");

        if (!variant) {
            return sendNotFoundResponse(res, "Product variant not found!");
        }

        let totalStock = 0;
        let sizeWiseStock = [];
        let priceInfo = { original: 0, discounted: 0 };

        if (variant.color?.sizes && variant.color.sizes.length > 0) {
            totalStock = variant.color.sizes.reduce((total, size) => total + (size.stock || 0), 0);
            sizeWiseStock = variant.color.sizes.map(size => ({
                sizeValue: size.sizeValue,
                stock: size.stock || 0,
                price: size.price || 0,
                discountedPrice: size.discountedPrice || null
            }));
            if (variant.color.sizes.length > 0) {
                priceInfo = {
                    original: variant.color.sizes[0].price || 0,
                    discounted: variant.color.sizes[0].discountedPrice || variant.color.sizes[0].price || 0
                };
            }
        } else if (variant.color) {
            totalStock = variant.color.stock || 0;
            priceInfo = {
                original: variant.color.price || 0,
                discounted: variant.color.discountedPrice || variant.color.price || 0
            };
        }

        return sendSuccessResponse(res, "Variant stock information fetched successfully!", {
            variantId: variant._id,
            sku: variant.sku,
            variantTitle: variant.variantTitle,
            colorName: variant.color?.colorName,
            totalStock,
            sizeWiseStock,
            price: priceInfo,
            hasSizes: variant.color?.sizes && variant.color.sizes.length > 0
        });
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const updateVariantStock = async (req, res) => {
    try {
        const { variantId } = req.params;
        const { sizes, stock, price, discountedPrice } = req.body;

        const userId = req.user?._id;
        const userRole = req.user?.role;

        if (!variantId || !mongoose.Types.ObjectId.isValid(variantId)) {
            return sendBadRequestResponse(res, "Valid variantId is required!");
        }

        const variant = await ProductVariant.findById(variantId);
        if (!variant) {
            return sendNotFoundResponse(res, "Product variant not found!");
        }

        if (userRole === "seller" && variant.sellerId.toString() !== userId.toString()) {
            return sendBadRequestResponse(res, "Unauthorized: You can only update your own product variants!");
        }

        if (sizes) {
            const sizesInput = typeof sizes === "string" ? JSON.parse(sizes) : sizes;

            if (!Array.isArray(sizesInput)) {
                return sendBadRequestResponse(res, "sizes must be an array.");
            }

            for (const newSize of sizesInput) {
                if (!newSize.sizeValue) {
                    return sendBadRequestResponse(res, "Each size must include sizeValue.");
                }

                const existingSizeIndex = variant.color.sizes.findIndex(
                    s => s.sizeValue === newSize.sizeValue
                );

                if (existingSizeIndex !== -1) {
                    if (newSize.stock !== undefined) {
                        variant.color.sizes[existingSizeIndex].stock = Number(newSize.stock);
                    }
                    if (newSize.price !== undefined) {
                        variant.color.sizes[existingSizeIndex].price = Number(newSize.price);
                    }
                    if (newSize.discountedPrice !== undefined) {
                        variant.color.sizes[existingSizeIndex].discountedPrice =
                            newSize.discountedPrice ? Number(newSize.discountedPrice) : null;
                    }
                } else {
                    variant.color.sizes.push({
                        sizeValue: newSize.sizeValue,
                        price: Number(newSize.price) || 0,
                        discountedPrice: newSize.discountedPrice ? Number(newSize.discountedPrice) : null,
                        stock: Number(newSize.stock) || 0
                    });
                }
            }

            variant.color.stock = null;
            variant.color.price = null;
            variant.color.discountedPrice = null;
        } else if (stock !== undefined) {
            variant.color.stock = Number(stock);
            variant.color.sizes = [];

            if (price !== undefined) variant.color.price = Number(price);
            if (discountedPrice !== undefined) variant.color.discountedPrice =
                discountedPrice ? Number(discountedPrice) : null;
        }

        await variant.save();

        const updatedVariant = await ProductVariant.findById(variantId)
            .select("color sku variantTitle");

        return sendSuccessResponse(res, "Variant stock updated successfully!", updatedVariant);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};