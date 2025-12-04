import mongoose from "mongoose";
import Product from "../models/product.model.js";
import ProductVariant from "../models/productVarient.model.js";
import sellerModel from "../models/seller.model.js";
import CategoryModel from "../models/category.model.js";
import brandModel from "../models/brand.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { deleteFromS3, updateS3, uploadToS3 } from "../utils/s3Service.js";

export const createProduct = async (req, res) => {
    try {
        const { brand, title, description } = req.body;
        const sellerId = req.user?._id;
        const productBannerImages = req.files;

        if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
            return sendBadRequestResponse(res, "Invalid or missing seller ID");
        }

        const seller = await sellerModel.findById(sellerId).populate("brandId");
        if (!seller) return sendNotFoundResponse(res, "Seller not found");

        if (!seller.brandId || seller.brandId.length === 0) {
            return sendBadRequestResponse(res, "Please add a brand first");
        }

        if (!brand) return sendBadRequestResponse(res, "Brand is required");
        if (!mongoose.Types.ObjectId.isValid(brand)) {
            return sendBadRequestResponse(res, "Invalid brand ID");
        }

        const selectedBrand = await brandModel.findById(brand);
        if (!selectedBrand) return sendNotFoundResponse(res, "Brand not found");

        const isValidBrand = seller.brandId.some(b => b._id.toString() === brand);
        if (!isValidBrand) return sendBadRequestResponse(res, "This brand does not belong to you");

        if (!title) return sendBadRequestResponse(res, "Title is required");

        if (!selectedBrand.categories || selectedBrand.categories.length === 0) {
            return sendBadRequestResponse(res, "This brand doesn't have any categories assigned");
        }

        const categories = selectedBrand.categories;

        const categoriesExist = await CategoryModel.find({ _id: { $in: categories } });
        if (categoriesExist.length !== categories.length) {
            return sendNotFoundResponse(res, "Some categories not found");
        }

        const existingProduct = await Product.findOne({
            title,
            sellerId,
            brand
        });
        if (existingProduct) return sendBadRequestResponse(res, "This product already exists");

        let productBannerUrls = [];
        if (productBannerImages && productBannerImages.length > 0) {
            for (const file of productBannerImages) {
                const imageUrl = await uploadToS3(file, "product-banners");
                productBannerUrls.push(imageUrl);
            }
        }

        const productData = {
            sellerId,
            brand,
            title,
            categories,
            description: description || "",
            productBanner: productBannerUrls
        };

        const newProduct = await Product.create(productData);

        await sellerModel.findByIdAndUpdate(
            sellerId,
            { $push: { products: newProduct._id } },
            { new: true }
        );

        const populatedProduct = await Product.findById(newProduct._id)
            .populate("brand", "brandName brandImage")
            .populate("categories", "name image");

        return sendSuccessResponse(res, "Product created successfully", populatedProduct);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const getAllProduct = async (req, res) => {
    try {
        const products = await Product.find()
            .populate("brand", "brandName logo description")
            .populate("sellerId", "firstName lastName email shopName")
            .populate("categories", "name image");

        return res.status(200).json({
            success: true,
            message: "Products fetched successfully",
            result: products || []
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error fetching products",
            error: error.message
        });
    }
};

export const getProductById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid Product ID" });
        }

        let product = await Product.findById(id)
            .populate("brand", "brandName brandImage")
            .populate("sellerId", "firstName lastName email mobileNo shopName pickUpAddr")
            .populate("categories", "name image");

        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }

        product.view = (product.view || 0) + 1;
        await product.save();

        const response = {
            _id: product._id,
            title: product.title,
            sellerId: product.sellerId,
            description: product.description,
            isActive: product.isActive,
            view: product.view,
            rating: product.rating,
            brand: product.brand,
            categories: product.categories,
            createdAt: product.createdAt,
            updatedAt: product.updatedAt
        };

        return res.status(200).json({ success: true, message: "Product fetched successfully", result: response });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
    }
};

export const getSellerProducts = async (req, res) => {
    try {
        const sellerId = req.user._id;
        const products = await Product.find({ sellerId })
            .populate("brand", "brandName logo description")
            .populate("sellerId", "firstName lastName email shopName")
            .populate("categories", "name image")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            message: "Seller products fetched",
            length: products.length,
            data: products || []
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};

export const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { brand, title, description, isActive } = req.body;
        const sellerId = req.user?._id;
        const productBannerImages = req.files;

        if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
            return sendBadRequestResponse(res, "Invalid seller ID");
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid product ID");
        }

        const product = await Product.findOne({ _id: id, sellerId });
        if (!product) return sendNotFoundResponse(res, "Product not found");

        const updateData = {};

        if (title && title !== product.title) updateData.title = title;
        if (description !== undefined && description !== product.description) updateData.description = description;
        if (isActive !== undefined && isActive !== product.isActive) updateData.isActive = isActive;

        if (brand && brand !== product.brand.toString()) {
            if (!mongoose.Types.ObjectId.isValid(brand)) {
                return sendBadRequestResponse(res, "Invalid brand ID");
            }
            const seller = await sellerModel.findById(sellerId).populate("brandId");
            if (!seller) return sendNotFoundResponse(res, "Seller not found");

            const isValidBrand = seller.brandId.some(b => b._id.toString() === brand);
            if (!isValidBrand) return sendBadRequestResponse(res, "This brand does not belong to you");

            updateData.brand = brand;

            const selectedBrand = await brandModel.findById(brand);
            if (selectedBrand && selectedBrand.categories && selectedBrand.categories.length > 0) {
                const newCategories = selectedBrand.categories.map(cat => cat.toString());
                const currentCategories = product.categories.map(cat => cat.toString());

                if (JSON.stringify(newCategories.sort()) !== JSON.stringify(currentCategories.sort())) {
                    updateData.categories = selectedBrand.categories;
                }
            }
        }

        if (productBannerImages && productBannerImages.length > 0) {
            let productBannerUrls = [...product.productBanner];

            for (let i = 0; i < productBannerImages.length; i++) {
                const file = productBannerImages[i];

                if (i < productBannerUrls.length) {
                    const oldImageUrl = productBannerUrls[i];
                    const key = oldImageUrl.split(".amazonaws.com/")[1];
                    const newImageUrl = await updateS3(key, file);
                    productBannerUrls[i] = newImageUrl;
                } else {
                    const imageUrl = await uploadToS3(file, "product-banners");
                    productBannerUrls.push(imageUrl);
                }
            }

            updateData.productBanner = productBannerUrls;
        }

        if (Object.keys(updateData).length === 0) {
            return sendBadRequestResponse(res, "No changes provided to update");
        }

        const updatedProduct = await Product.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        )
            .populate('brand', 'brandName')
            .populate('categories', 'name');

        return sendSuccessResponse(res, "Product updated successfully", updatedProduct);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?._id;
        const userRole = req.user?.role;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequestResponse(res, "Invalid ProductId");
        }

        const product = await Product.findById(id);
        if (!product) return sendNotFoundResponse(res, "Product not found");

        // Authorization check
        if (userRole === 'seller' && product.sellerId.toString() !== userId.toString()) {
            return sendBadRequestResponse(res, "You can only delete your own products");
        }

        if (userRole !== 'admin' && userRole !== 'seller') {
            return sendBadRequestResponse(res, "Unauthorized access");
        }

        // Delete product banner images from S3
        if (product.productBanner && product.productBanner.length > 0) {
            for (const imgUrl of product.productBanner) {
                try {
                    const key = imgUrl.split(".amazonaws.com/")[1];
                    await deleteFromS3(key);
                } catch (error) {
                    console.log("Error deleting image from S3:", error.message);
                }
            }
        }

        // Delete product from database
        await Product.findByIdAndDelete(id);

        // Remove product reference from seller
        await sellerModel.findByIdAndUpdate(
            product.sellerId,
            { $pull: { products: product._id } },
            { new: true }
        );

        const message = userRole === 'admin'
            ? "Product deleted successfully by admin"
            : "Product deleted successfully";

        return sendSuccessResponse(res, message, product);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const getProductByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
            return sendBadRequestResponse(res, "Valid categoryId is required");
        }

        const products = await Product.find({ categories: categoryId })
            .populate("sellerId")
            .populate("brand")
            .populate("categories");

        if (products.length === 0) {
            return sendNotFoundResponse(res, "No products found for this category");
        }

        return sendSuccessResponse(res, "Products fetched successfully", products || []);
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};

export const getProductsByBrand = async (req, res) => {
    try {
        const { brandId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(brandId)) {
            return sendBadRequestResponse(res, "Invalid brand ID");
        }

        const brand = await brandModel.findById(brandId).lean();
        if (!brand) return sendNotFoundResponse(res, "Brand not found");

        const products = await Product.find({ brand: brandId, isActive: true })
            .populate("sellerId", "firstName lastName email shopName")
            .populate("brand", "brandName brandImage")
            .populate("categories", "name image")
            .lean();

        return sendSuccessResponse(res, `Products for brand ${brand.brandName} fetched successfully`, {
            brandId: brand._id,
            brandName: brand.brandName,
            brandImage: brand.brandImage,
            products: products || []
        });
    } catch (error) {
        return sendErrorResponse(res, 500, error.message);
    }
};