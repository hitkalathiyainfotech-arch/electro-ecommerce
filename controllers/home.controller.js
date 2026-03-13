import mongoose from "mongoose";
import brandModel from "../models/brand.model.js";
import productModel from "../models/product.model.js";
import productVarientModel from "../models/productVarient.model.js";
import { sendErrorResponse, sendSuccessResponse } from "../utils/response.utils.js";

import reviewModel from "../models/review.model.js";
import categoryModel from "../models/category.model.js";

const getAllChildCategoryIds = async (categoryId) => {
  const children = await categoryModel.find({ parentCategory: categoryId }).select("_id");
  let allIds = children.map(c => c._id);

  for (const child of children) {
    const subChildren = await getAllChildCategoryIds(child._id);
    allIds = [...allIds, ...subChildren];
  }
  return allIds;
};

export const newArrival = async (req, res) => {
  try {
    const products = await productModel
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate({
        path: "variantId",
        perDocumentLimit: 1
      });

    const formatted = products.map(p => ({
      ...p._doc,
      variantId: p.variantId?.length ? [p.variantId[0]] : []
    }));

    return sendSuccessResponse(
      res,
      "New Arrivals fetched successfully",
      formatted
    );
  } catch (error) {
    return sendErrorResponse(res, 500, "error while get newArrival", error);
  }
};

export const bestSeller = async (req, res) => {
  try {
    const products = await productModel
      .find({})
      .sort({ sold: -1 })
      .limit(15)
      .populate({
        path: "variantId",
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId && p.variantId.length > 0 ? p.variantId : []
      }
    });

    return sendSuccessResponse(res, "best selling Products", formatted);
  } catch (error) {

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
      .populate({
        path: "variantId",
      });

    const formatted = products.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId && p.variantId.length > 0 ? p.variantId : []
      }
    });

    return sendSuccessResponse(res, "New Products fetched successfully", formatted);
  } catch (error) {

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
                { $multiply: ["$view", 1] },
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
      .populate({
        path: "variantId",
      });

    const formatted = finalProducts.map(p => {
      return {
        ...p._doc,
        variantId: p.variantId && p.variantId.length > 0 ? p.variantId : []
      }
    });

    return sendSuccessResponse(res, "Trending Deals Products", formatted);
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while fetching trending deals", error);
  }
};

export const grabNowDeals = async (req, res) => {
  try {
    const variants = await productVarientModel.find({})
      .populate("productId")
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

      const product = v.productId;
      if (!product) continue;

      const allVariants = await productVarientModel.find({
        productId: product._id
      });

      deals.push({
        ...product._doc,
        variantId: allVariants,
        dealDetails: {
          selectedVariantId: v._id,
          variantTitle: v.variantTitle,
          images: color.images || [],
          originalPrice,
          discountedPrice: effectivePrice,
          discountPercent,
          stock
        }
      });
    }

    deals.sort((a, b) => {
      if (b.dealDetails.discountPercent !== a.dealDetails.discountPercent) {
        return b.dealDetails.discountPercent - a.dealDetails.discountPercent;
      }
      return a.dealDetails.discountedPrice - b.dealDetails.discountedPrice;
    });

    const uniqueDeals = [];
    const seenProductIds = new Set();

    for (const deal of deals) {
      if (!seenProductIds.has(deal._id.toString())) {
        seenProductIds.add(deal._id.toString());
        uniqueDeals.push(deal);
      }
    }

    return sendSuccessResponse(res, "Grab Now Deals Fetched", uniqueDeals.slice(0, 10));
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAppFilters = async (req, res) => {
  try {
    const { categoryId, q, brandId } = req.query;

    const inputCategoryId = categoryId || req.query.categories || req.query.category;
    let selectedCategoryIds = [];

    if (inputCategoryId) {
      if (Array.isArray(inputCategoryId)) {
        selectedCategoryIds = inputCategoryId
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      } else if (typeof inputCategoryId === "string") {
        selectedCategoryIds = inputCategoryId
          .split(",")
          .map(id => id.trim())
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      }
    }

    let matchQuery = { isActive: true };

    if (q && q.trim()) {
      matchQuery.$or = [
        { title: { $regex: q.trim(), $options: "i" } },
        { description: { $regex: q.trim(), $options: "i" } }
      ];
    }

    if (selectedCategoryIds.length > 0) {
      let allRelevantCategoryIds = [...selectedCategoryIds];
      for (const catId of selectedCategoryIds) {
        const childIds = await getAllChildCategoryIds(catId);
        const objectIdChilds = childIds.map(id => new mongoose.Types.ObjectId(id));
        allRelevantCategoryIds = [...allRelevantCategoryIds, ...objectIdChilds];
      }
      matchQuery.categories = { $in: allRelevantCategoryIds };
    }

    const inputBrandId = brandId || req.query.brands || req.query.brand;
    let selectedBrandIds = [];
    if (inputBrandId) {
      if (Array.isArray(inputBrandId)) {
        selectedBrandIds = inputBrandId
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      } else if (typeof inputBrandId === "string") {
        selectedBrandIds = inputBrandId
          .split(",")
          .map(id => id.trim())
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      }
    }

    if (selectedBrandIds.length > 0) {
      matchQuery.brand = { $in: selectedBrandIds };
    }

    const products = await productModel
      .find(matchQuery)
      .populate("brand", "brandName")
      .populate("categories", "name parentCategory")
      .populate("variantId")
      .lean();

    const categorySet = new Set();
    const subCategorySet = new Set();
    const brandSet = new Set();
    const colorSet = new Set();
    const sizeSet = new Set();
    const discountSet = new Set();
    const ratingSet = new Set();

    let minTotal = Infinity;
    let maxTotal = -Infinity;

    if (selectedCategoryIds.length === 1) {
      const subCats = await categoryModel.find({ parentCategory: selectedCategoryIds[0] });
      subCats.forEach(sc => {
        if (sc.name) subCategorySet.add(sc.name);
      });
    }

    products.forEach((p) => {
      if (p.brand?.brandName) brandSet.add(p.brand.brandName);
      if (p.rating?.average >= 0) ratingSet.add(Math.floor(p.rating.average));

      if (selectedCategoryIds.length !== 1) {
        p.categories?.forEach((cat) => {
          if (cat.name) subCategorySet.add(cat.name);
        });
      }

      p.variantId?.forEach((v) => {
        if (v.color?.colorName) colorSet.add(v.color.colorName);

        if (v.color?.sizes && v.color.sizes.length > 0) {
          v.color?.sizes?.forEach((s) => {
            if (s.sizeValue) sizeSet.add(s.sizeValue);

            const priceToUse = s.discountedPrice > 0 ? s.discountedPrice : s.price;
            if (priceToUse > 0) {
              minTotal = Math.min(minTotal, priceToUse);
              maxTotal = Math.max(maxTotal, priceToUse);
            }

            if (s.price > 0 && s.discountedPrice > 0) {
              const percent = Math.round(((s.price - s.discountedPrice) / s.price) * 100);
              const range = Math.floor(percent / 10) * 10;
              if (range > 0) discountSet.add(range);
            }
          });
        } else if (v.color) {
          const priceToUse = v.color.discountedPrice > 0 ? v.color.discountedPrice : v.color.price;
          if (priceToUse > 0) {
            minTotal = Math.min(minTotal, priceToUse);
            maxTotal = Math.max(maxTotal, priceToUse);
          }
          if (v.color.price > 0 && v.color.discountedPrice > 0) {
            const percent = Math.round(((v.color.price - v.color.discountedPrice) / v.color.price) * 100);
            const range = Math.floor(percent / 10) * 10;
            if (range > 0) discountSet.add(range);
          }
        }
      });
    });

    let selectedCatName = null;
    if (selectedCategoryIds.length === 1) {
      const cat = await categoryModel.findById(selectedCategoryIds[0]);
      if (cat) selectedCatName = cat.name;
    }

    return res.status(200).json({
      success: true,
      selected: {
        category: selectedCatName,
        subCategory: null,
      },
      filters: {
        categories: [],
        subCategories: [...subCategorySet].filter(Boolean).sort(),
        brands: [...brandSet].filter(Boolean).sort(),
        colors: [...colorSet].filter(Boolean).map((c) => c.charAt(0).toUpperCase() + c.slice(1)).sort(),
        sizes: [...sizeSet].filter(Boolean).sort(),
        ratings: [...ratingSet].sort((a, b) => a - b),
        price: {
          min: minTotal === Infinity ? 0 : Math.floor(minTotal),
          max: maxTotal === -Infinity ? 0 : Math.ceil(maxTotal)
        },
        discount: [...discountSet].length
          ? [...discountSet].sort((a, b) => a - b)
          : [10, 20, 30, 40, 50, 60, 70]
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
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
      sort,
      discount,
      page,
      limit,
      ...dynamicQueryParams
    } = req.query;

    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;
    const minRating = rating ? Number(rating) : null;
    const minDiscount = discount ? Number(discount) : null;

    console.log("Received Query:", req.query);
    console.log("Parsed minDiscount:", minDiscount);

    const matchQuery = { isActive: true };

    if (q && q.trim()) {
      matchQuery.$or = [
        { title: { $regex: q.trim(), $options: "i" } },
        { description: { $regex: q.trim(), $options: "i" } }
      ];
    }

    const inputCategoryId = req.query.categoryId || req.query.categories || req.query.category;
    let selectedCategoryIds = [];

    if (inputCategoryId) {
      if (Array.isArray(inputCategoryId)) {
        selectedCategoryIds = inputCategoryId
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      } else if (typeof inputCategoryId === "string") {
        selectedCategoryIds = inputCategoryId
          .split(",")
          .map(id => id.trim())
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      }
    }

    let brandIds = [];

    if (selectedCategoryIds.length > 0) {
      let allRelevantCategoryIds = [...selectedCategoryIds];

      for (const catId of selectedCategoryIds) {
        const childIds = await getAllChildCategoryIds(catId);
        const objectIdChilds = childIds.map(id => new mongoose.Types.ObjectId(id));
        allRelevantCategoryIds = [...allRelevantCategoryIds, ...objectIdChilds];
      }

      const brands = await brandModel.find(
        { categories: { $in: allRelevantCategoryIds } },
        { _id: 1 }
      );

      brandIds = brands.map(b => b._id);
      matchQuery.categories = { $in: allRelevantCategoryIds };
    }

    const inputBrandId = req.query.brandId || req.query.brands || req.query.brand;
    let selectedBrandIds = [];

    if (inputBrandId) {
      if (Array.isArray(inputBrandId)) {
        selectedBrandIds = inputBrandId
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      } else if (typeof inputBrandId === "string") {
        selectedBrandIds = inputBrandId
          .split(",")
          .map(id => id.trim())
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
      }
    }

    if (selectedBrandIds.length > 0) {
      matchQuery.brand = { $in: selectedBrandIds };
    } else if (brandIds.length > 0) {
      matchQuery.brand = { $in: brandIds };
    }

    let products = await productModel.find(matchQuery)
      .populate("variantId")
      .sort({ createdAt: -1 });

    const formattedProducts = products.map(product => {
      return {
        ...product._doc,
        brand: product.brand,
        categories: product.categories,
        variantId: product.variantId || []
      };
    });

    let filteredProducts = formattedProducts;

    if (min !== null || max !== null || color || size || minDiscount !== null) {
      filteredProducts = filteredProducts
        .map(product => {
          const variants = product.variantId.filter(variant => {
            let ok = true;

            const pricingDetails =
              variant.color.sizes && variant.color.sizes.length > 0
                ? variant.color.sizes.map(s => ({
                  price: s.price,
                  discountedPrice: s.discountedPrice !== null ? s.discountedPrice : s.price
                }))
                : [
                  {
                    price: variant.color.price,
                    discountedPrice: variant.color.discountedPrice !== null
                      ? variant.color.discountedPrice
                      : variant.color.price
                  }
                ];

            const prices = pricingDetails.map(p => p.discountedPrice);

            if (min !== null) ok = ok && prices.some(p => p >= min);
            if (max !== null) ok = ok && prices.some(p => p <= max);

            if (minDiscount !== null) {
              const hasDiscount = pricingDetails.some(p => {
                if (p.price && p.discountedPrice < p.price) {
                  const discountPercentage = ((p.price - p.discountedPrice) / p.price) * 100;
                  return discountPercentage >= minDiscount;
                }
                return false;
              });
              ok = ok && hasDiscount;
            }

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

            const excludedParams = ["categories", "category", "brands", "brand"];
            const dynamicKeys = Object.keys(dynamicQueryParams).filter(k => !excludedParams.includes(k));
            if (dynamicKeys.length > 0) {
              let matchesDynamic = true;
              for (const dKey of dynamicKeys) {
                const requestedValues = dynamicQueryParams[dKey].toString().split(",").map(v => v.trim().toLowerCase());
                let hasValue = false;

                if (variant.overview) {
                  for (const item of variant.overview) {
                    if (item.key && item.key.trim() === dKey) {
                      if (item.value && requestedValues.includes(item.value.trim().toLowerCase())) {
                        hasValue = true;
                        break;
                      }
                    }
                  }
                }

                if (!hasValue && variant.specification) {
                  for (const spec of variant.specification) {
                    if (spec.details) {
                      for (const detail of spec.details) {
                        if (detail.key && detail.key.trim() === dKey) {
                          if (detail.value && requestedValues.includes(detail.value.trim().toLowerCase())) {
                            hasValue = true;
                            break;
                          }
                        }
                      }
                    }
                    if (hasValue) break;
                  }
                }

                if (!hasValue) {
                  matchesDynamic = false;
                  break;
                }
              }
              ok = ok && matchesDynamic;
            }

            return ok;
          });

          if (variants.length > 0) {
            return {
              ...product,
              variantId: variants
            };
          }
          return null;
        })
        .filter(Boolean);
    }

    if (minRating !== null) {
      const productIds = filteredProducts.map(p => p._id);

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
          average: Number(r.avgRating.toFixed(1)),
          totalReviews: r.totalReviews
        };
      });

      filteredProducts = filteredProducts
        .filter(p => ratingMap[p._id.toString()])
        .map(p => {
          return {
            ...p,
            rating: ratingMap[p._id.toString()]
          };
        });
    }

    if (sort) {
      if (sort === "latest") {
        filteredProducts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }

      if (sort === "popular") {
        filteredProducts.sort(
          (a, b) =>
            (b.rating?.totalReviews || 0) -
            (a.rating?.totalReviews || 0)
        );
      }

      if (sort === "rating") {
        filteredProducts.sort(
          (a, b) =>
            (b.rating?.average || 0) -
            (a.rating?.average || 0)
        );
      }

      if (sort === "priceLow") {
        filteredProducts.sort((a, b) => {
          const priceA = getMinPriceFromVariants(a.variantId);
          const priceB = getMinPriceFromVariants(b.variantId);
          return priceA - priceB;
        });
      }

      if (sort === "priceHigh") {
        filteredProducts.sort((a, b) => {
          const priceA = getMinPriceFromVariants(a.variantId);
          const priceB = getMinPriceFromVariants(b.variantId);
          return priceB - priceA;
        });
      }
    }

    let pageObj = Number(req.query.page) || 1;
    let limitObj = Number(req.query.limit) || 20;
    const total = filteredProducts.length;

    const skip = (pageObj - 1) * limitObj;
    const paginatedProducts = filteredProducts.slice(skip, skip + limitObj);

    return res.status(200).json({
      success: true,
      total,
      page: pageObj,
      limit: limitObj,
      pages: Math.ceil(total / limitObj),
      data: paginatedProducts
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Error while filtering products"
    });
  }
};

function getMinPriceFromVariants(variants) {
  if (!variants || variants.length === 0) return Infinity;

  let minPrice = Infinity;
  variants.forEach(variant => {
    const color = variant.color;
    if (!color) return;

    if (color.sizes && color.sizes.length > 0) {
      color.sizes.forEach(size => {
        const price = size.discountedPrice || size.price;
        if (price < minPrice) minPrice = price;
      });
    } else {
      const price = color.discountedPrice || color.price;
      if (price < minPrice) minPrice = price;
    }
  });

  return minPrice === Infinity ? 0 : minPrice;
}