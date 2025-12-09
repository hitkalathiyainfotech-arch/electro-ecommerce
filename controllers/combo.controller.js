import mongoose from "mongoose";
import comboModel from "../models/combo.model.js";
import Product from "../models/product.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse, sendCreatedResponse } from "../utils/response.utils.js";

export const createCombo = async (req, res) => {
  try {
    const sellerId = req.user?._id;
    const { title, description, products, discountPercentage } = req.body;

    if (!title || !products || discountPercentage === undefined) {
      return sendBadRequestResponse(res, "title, products, and discountPercentage are required");
    }

    if (discountPercentage < 0 || discountPercentage > 100) {
      return sendBadRequestResponse(res, "discountPercentage must be between 0 and 100");
    }

    let parsedProducts = products;
    if (typeof products === "string") {
      try {
        parsedProducts = JSON.parse(products);
      } catch (err) {
        return sendBadRequestResponse(res, "Invalid products payload. Send as JSON array or object");
      }
    }

    if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) {
      return sendBadRequestResponse(res, "At least one product required in combo");
    }

    // validate product ids
    const productIds = parsedProducts.map(p => p.product).filter(Boolean);
    if (!productIds.every(id => mongoose.Types.ObjectId.isValid(id))) {
      return sendBadRequestResponse(res, "One or more product IDs are invalid");
    }

    const foundProducts = await Product.find({ _id: { $in: productIds } }).lean();
    if (foundProducts.length !== productIds.length) {
      return sendNotFoundResponse(res, "Some products not found");
    }

    // if seller created, ensure ownership
    if (req.user?.role === "seller") {
      const notOwned = foundProducts.filter(p => p.sellerId.toString() !== sellerId.toString());
      if (notOwned.length > 0) return sendBadRequestResponse(res, "You can only add your own products to a combo");
    }

    // Calculate original and discounted prices based on variants if available
    let totalOriginalPrice = 0;
    const ProductVariant = mongoose.model("productVariant");

    for (const comboProduct of parsedProducts) {
      const product = foundProducts.find(p => p._id.toString() === comboProduct.product.toString());
      if (!product) continue;

      const qty = comboProduct.quantity || 1;
      let productPrice = 0;

      // Get price from variant if variant exists
      if (comboProduct.variant) {
        try {
          const variant = await ProductVariant.findById(comboProduct.variant).lean();
          if (variant && variant.color) {
            // If variant has sizes, use first available size's price
            if (Array.isArray(variant.color.sizes) && variant.color.sizes.length > 0) {
              const availableSize = variant.color.sizes.find(s => s.stock > 0);
              productPrice = availableSize?.price || variant.color.sizes[0].price || 0;
            } else {
              // Use color price if no sizes
              productPrice = variant.color.price || 0;
            }
          }
        } catch (e) {
          // Fallback to product price
          productPrice = product.price || product.sellingPrice || 0;
        }
      } else {
        // Use product price
        productPrice = product.price || product.sellingPrice || 0;
      }

      totalOriginalPrice += productPrice * qty;
    }

    const totalDiscountedPrice = Math.round(totalOriginalPrice * (1 - discountPercentage / 100));

    const comboData = {
      title,
      description: description || "",
      products: parsedProducts.map(p => ({
        product: p.product,
        variant: p.variant || null,
        quantity: p.quantity || 1
      })),
      discountPercentage,
      calculatedOriginalPrice: totalOriginalPrice,
      calculatedDiscountedPrice: totalDiscountedPrice,
      createdBy: sellerId
    };

    const newCombo = await comboModel.create(comboData);

    return sendCreatedResponse(res, "Combo created successfully", newCombo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAllCombos = async (req, res) => {
  try {
    const combos = await comboModel.find({ isActive: true })
      .populate({
        path: "products.product",
        populate: [
          { path: "brand", select: "-categories -sellerId -__v -updatedAt -createdAt" },
          { path: "categories", select: "-__v -createdAt -updatedAt " },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar");

    return sendSuccessResponse(res, "Combos fetched successfully", {
      total: combos.length,
      combos
    } || []);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export const getComboById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id)
      .populate({
        path: "products.product",
        populate: [
          { path: "brand", select: "-categories -sellerId -__v -updatedAt -createdAt" },
          { path: "categories", select: "-__v -createdAt -updatedAt " },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar");

    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    return sendSuccessResponse(res, "Combo fetched successfully", {
      total: combos.length,
      combo
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getSellerCombos = async (req, res) => {
  try {
    const sellerId = req.user?._id;
    const combos = await comboModel.find({ createdBy: sellerId })
      .populate({
        path: "products.product",
        populate: [
          { path: "brand", select: "-categories -sellerId -__v -updatedAt -createdAt" },
          { path: "categories", select: "-__v -createdAt -updatedAt " },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar")
      .sort({ createdAt: -1 });
    return sendSuccessResponse(res, "Seller combos fetched", {
      total: combos.length,
      combos
    } || []);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const updateCombo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id);
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    const userId = req.user?._id;
    if (req.user?.role === "seller" && combo.createdBy.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only update your own combos");
    }

    const updates = req.body;
    // If products sent as stringified JSON
    if (typeof updates.products === "string") {
      try { updates.products = JSON.parse(updates.products); } catch (e) { }
    }

    Object.keys(updates).forEach(k => {
      combo[k] = updates[k];
    });

    await combo.save();

    return sendSuccessResponse(res, "Combo updated successfully", combo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const deleteCombo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id);
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    const userId = req.user?._id;
    if (req.user?.role === "seller" && combo.createdBy.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only delete your own combos");
    }

    await comboModel.findByIdAndDelete(id);
    return sendSuccessResponse(res, "Combo deleted successfully", combo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const toggleComboActive = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id);
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    const userId = req.user?._id;
    if (req.user?.role === "seller" && combo.createdBy.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only change your own combos");
    }

    combo.isActive = !combo.isActive;
    await combo.save();

    return sendSuccessResponse(res, `Combo ${combo.isActive ? 'activated' : 'deactivated'} successfully`, combo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

// Basic apply endpoint: returns computed saving for the combo
export const applyCombo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id).lean();
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    if (!combo.isActive) return sendBadRequestResponse(res, "Combo is not active");

    const saving = combo.calculatedOriginalPrice - combo.calculatedDiscountedPrice;
    const result = {
      comboId: combo._id,
      title: combo.title,
      discountPercentage: combo.discountPercentage,
      calculatedOriginalPrice: combo.calculatedOriginalPrice,
      calculatedDiscountedPrice: combo.calculatedDiscountedPrice,
      saving: saving
    };

    return sendSuccessResponse(res, "Combo applied", result);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getProductSellerCombos = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId) return sendBadRequestResponse(res, "productId is required");
    if (!mongoose.Types.ObjectId.isValid(productId))
      return sendBadRequestResponse(res, "Invalid productId");

    const product = await Product.findById(productId).lean();
    if (!product) return sendNotFoundResponse(res, "Product not found");

    const sellerId = product.sellerId;

    const combos = await comboModel
      .find({ createdBy: sellerId, isActive: true })
      .populate({
        path: "products.product",
        model: "product",
        populate: [
          { path: "brand" },
          { path: "categories" },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar")
      .lean();

    return sendSuccessResponse(res, "Seller combos fetched for product", {
      total: combos.length,
      combos
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export default {
  createCombo,
  getAllCombos,
  getComboById,
  getSellerCombos,
  updateCombo,
  deleteCombo,
  toggleComboActive,
  applyCombo,
  getProductSellerCombos
};
