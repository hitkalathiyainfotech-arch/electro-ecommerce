import mongoose from "mongoose";
import brandModel from "../models/brand.model.js";
import productModel from "../models/product.model.js";
import productVarientModel from "../models/productVarient.model.js";
import { sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";
import { createProductVariant } from "./productVariant.controller.js";
import reviewModel from "../models/review.model.js";

export const newArrival = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const products = await productModel
      .find({
        createdAt: { $gte: thirtyDaysAgo },
        isActive: true
      })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate("brand")
      .populate("categories")
      .populate({
        path: "variantId",
        options: { limit: 1 }
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId.length > 0 ? [p.variantId[0]] : []
      }
    });

    return sendSuccessResponse(res, "New Arrivals fetched successfully", {
      total: formatted.length,
      products: formatted
    });
  } catch (error) {
    console.log("error while get newArrival : " + error);
    return sendErrorResponse(res, 500, "error while get newArrival", error);
  }
}

export const bestSeller = async (req, res) => {
  try {
    const products = await productModel.find({}).sort({ sold: -1 }).limit(15);

    return sendSuccessResponse(res, "best selling Products", products);
  } catch (error) {
    console.log("Error while bestSeller", error)
    return sendErrorResponse(res, 500, "Error while bestSeller", error)
  }
}

export const newProducts = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const products = await productModel
      .find({ 
        isActive: true,
        createdAt: { $lt: thirtyDaysAgo }
      })
      .sort({ view: -1, sold: -1 })
      .limit(6)
      .populate("brand")
      .populate("categories")
      .populate({
        path: "variantId",
        options: { limit: 1 }
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId.length > 0 ? [p.variantId[0]] : []
      }
    });

    return sendSuccessResponse(res, "New Products fetched successfully", {
      total: formatted.length,
      products: formatted
    });
  } catch (error) {
    console.log("Error while fetching new products", error);
    return sendErrorResponse(res, 500, "Error while fetching new products", error);
  }
}

export const trendingDeals = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;
    const skip = (page - 1) * limit;

    const products = await productModel
      .aggregate([
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ["$sold", 2] },
                { $multiply: ["$views", 1] },
                {
                  $cond: [
                    { $gte: ["$createdAt", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)] },
                    50,
                    0
                  ]
                }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $skip: skip },
        { $limit: limit }
      ]);

    const ids = products.map(x => x._id);

    const finalProducts = await productModel
      .find({ _id: { $in: ids } })
      .populate("sellerId", "firstName email mobileNo avatar")
      .populate("brand", "brandName brandImage")
      .populate("categories", "name image")
      .populate("variantId", "-overview -key_features -specification")

    return sendSuccessResponse(res, "Trending Deals Products", {
      total: finalProducts.length,
      products: finalProducts
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while fetching trending deals", error);
  }
};

export const grabNowDeals = async (req, res) => {
  try {
    const variants = await productVarientModel.find({})
      .populate({
        path: "productId",
        populate: [
          { path: "brand" },
          { path: "categories" },
        ]
      })
      .populate("sellerId");

    const deals = [];

    for (const v of variants) {
      const color = v.color;
      if (!color) continue;

      let effectivePrice = 0;
      let originalPrice = 0;
      let stock = 0;

      if (color.sizes && color.sizes.length > 0) {
        const sizesInStock = color.sizes.filter(s => s.stock > 0);
        if (sizesInStock.length === 0) continue;

        const size = sizesInStock[0];

        originalPrice = size.price;
        effectivePrice = size.discountedPrice || size.price;
        stock = size.stock;
      } else {
        if (color.stock <= 0) continue;

        originalPrice = color.price;
        effectivePrice = color.discountedPrice || color.price;
        stock = color.stock;
      }

      const discountPercent =
        originalPrice > 0
          ? Math.round(((originalPrice - effectivePrice) / originalPrice) * 100)
          : 0;

      deals.push({
        variantId: v._id,
        productId: v.productId,
        sellerId: v.sellerId,
        variantTitle: v.variantTitle,
        images: color.images || [],
        originalPrice,
        discountedPrice: effectivePrice,
        discountPercent,
        stock
      });
    }

    deals.sort((a, b) => {
      if (b.discountPercent !== a.discountPercent) {
        return b.discountPercent - a.discountPercent;
      }
      return a.discountedPrice - b.discountedPrice;
    });

    return sendSuccessResponse(res, "Grab Now Deals Fetched", {
      total: deals.length,
      products: deals.slice(0, 10)
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getFiltteredProducts = async (req, res) => {
  try {
    const {
      q,
      categoryId,
      brandId,
      minPrice,
      maxPrice,
      color,
      size,
      rating,
      sort
    } = req.query;

    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;
    const minRating = rating ? Number(rating) : null;

    const matchQuery = { isActive: true };

    if (q && q.trim()) {
      matchQuery.$or = [
        { title: { $regex: q.trim(), $options: "i" } },
        { description: { $regex: q.trim(), $options: "i" } }
      ];
    }

    let brandIds = [];

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      const brands = await brandModel.find(
        { categories: new mongoose.Types.ObjectId(categoryId) },
        { _id: 1 }
      );

      brandIds = brands.map(b => b._id);
      matchQuery.categories = new mongoose.Types.ObjectId(categoryId);
    }

    if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
      matchQuery.brand = new mongoose.Types.ObjectId(brandId);
    } else if (brandIds.length > 0) {
      matchQuery.brand = { $in: brandIds };
    }

    let products = await productModel.find(matchQuery)
      .populate("brand")
      .populate("categories")
      .populate("sellerId", "firstName mobileNo email avatar role")
      .populate("variantId")
      .sort({ createdAt: -1 });

    if (min !== null || max !== null || color || size) {
      products = products
        .map(product => {
          const variants = product.variantId.filter(variant => {
            let ok = true;

            const prices =
              variant.color.sizes && variant.color.sizes.length > 0
                ? variant.color.sizes.map(s =>
                  s.discountedPrice !== null ? s.discountedPrice : s.price
                )
                : [
                  variant.color.discountedPrice !== null
                    ? variant.color.discountedPrice
                    : variant.color.price
                ];

            if (min !== null) ok = ok && prices.some(p => p >= min);
            if (max !== null) ok = ok && prices.some(p => p <= max);

            if (color) {
              ok =
                ok &&
                variant.color.colorName.toLowerCase() ===
                color.toLowerCase();
            }

            if (size) {
              ok =
                ok &&
                variant.color.sizes &&
                variant.color.sizes.some(s => s.sizeValue === size);
            }

            return ok;
          });

          if (variants.length > 0) {
            product.variantId = variants;
            return product;
          }
          return null;
        })
        .filter(Boolean);
    }

    if (minRating !== null) {
      const productIds = products.map(p => p._id);

      const ratingAgg = await reviewModel.aggregate([
        { $match: { productId: { $in: productIds } } },
        {
          $group: {
            _id: "$productId",
            avgRating: { $avg: "$overallRating" },
            totalReviews: { $sum: 1 }
          }
        },
        {
          $match: {
            avgRating: { $gte: minRating }
          }
        }
      ]);

      const ratingMap = {};
      ratingAgg.forEach(r => {
        ratingMap[r._id.toString()] = {
          avgRating: Number(r.avgRating.toFixed(1)),
          totalReviews: r.totalReviews
        };
      });

      products = products
        .filter(p => ratingMap[p._id.toString()])  // <- only products with reviews >= minRating
        .map(p => {
          p._doc.rating = ratingMap[p._id.toString()];
          return p;
        });
    }


    if (sort) {
      if (sort === "latest") {
        products.sort((a, b) => b.createdAt - a.createdAt);
      }

      if (sort === "popular") {
        products.sort(
          (a, b) =>
            (b.rating?.totalReviews || 0) -
            (a.rating?.totalReviews || 0)
        );
      }

      if (sort === "rating") {
        products.sort(
          (a, b) =>
            (b.rating?.avgRating || 0) -
            (a.rating?.avgRating || 0)
        );
      }

      if (sort === "priceLow") {
        products.sort(
          (a, b) =>
            a.variantId[0]?.color?.discountedPrice -
            b.variantId[0]?.color?.discountedPrice
        );
      }

      if (sort === "priceHigh") {
        products.sort(
          (a, b) =>
            b.variantId[0]?.color?.discountedPrice -
            a.variantId[0]?.color?.discountedPrice
        );
      }
    }

    return sendSuccessResponse(res, "Products fetched successfully", {
      total: products.length,
      products
    });

  } catch (error) {
    console.log("error while filtering products", error);
    return sendErrorResponse(res, 500, "Error while filtering products", error);
  }
};



