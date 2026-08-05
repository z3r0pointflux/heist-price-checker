const itemNameEl = document.getElementById('item-name')!;
const baseNameEl = document.getElementById('base-name')!;
const chaosPriceEl = document.getElementById('chaos-price')!;
const priceCaptionEl = document.getElementById('price-caption')!;
const variantListEl = document.getElementById('variant-list')!;
const listingsEl = document.getElementById('listings')!;
const priceSection = document.getElementById('price-section')!;
const noPriceEl = document.getElementById('no-price')!;

window.heistAPI.onPriceResult((data: any) => {
  const { itemInfo, price } = data;

  // Set item name with color class. An unidentified item's "name" is only the
  // most name-like OCR line, so label it instead of passing it off as the item.
  if (itemInfo.unidentified) {
    itemNameEl.textContent = "Couldn't identify item";
    itemNameEl.className = 'unidentified';
  } else {
    itemNameEl.textContent = itemInfo.displayName;
    itemNameEl.className = itemInfo.type;
  }

  // Set base name
  if (itemInfo.unidentified) {
    baseNameEl.textContent = itemInfo.displayName
      ? `read: "${itemInfo.displayName}" — try re-hovering`
      : 'try re-hovering the item';
    baseNameEl.style.display = 'block';
  } else if (itemInfo.baseName && itemInfo.type !== 'currency') {
    baseNameEl.textContent = itemInfo.type === 'rare'
      ? `Rare Base \u2014 ${itemInfo.baseName}`
      : itemInfo.baseName;
    baseNameEl.style.display = 'block';
  } else {
    baseNameEl.style.display = 'none';
  }

  // Set price info
  if (price) {
    priceSection.style.display = 'block';
    noPriceEl.style.display = 'none';

    // Headline is always the cheapest listing on poe.ninja.
    chaosPriceEl.textContent = `${formatPrice(price.minChaos)} Chaos`;
    chaosPriceEl.style.display = 'block';

    // Say where that number came from, and flag it when it rests on very few
    // listings so a thin outlier isn't mistaken for a reliable price.
    const caption: string[] = ['lowest'];
    if (price.lowestLabel) {
      caption.push(/^\d+$/.test(String(price.lowestLabel)) ? `ilvl ${price.lowestLabel}` : price.lowestLabel);
    }
    if (typeof price.lowestListings === 'number' && price.lowestListings > 0) {
      caption.push(`${price.lowestListings} listing${price.lowestListings === 1 ? '' : 's'}`);
    }
    priceCaptionEl.textContent = caption.join(' · ');
    priceCaptionEl.className =
      typeof price.lowestListings === 'number' && price.lowestListings > 0 && price.lowestListings < 5
        ? 'low-confidence'
        : '';
    priceCaptionEl.style.display = 'block';

    // Keep the per-ilvl breakdown underneath so the spread is still visible.
    const labeled = (price.variants || []).filter((v: any) => v.label);
    if (labeled.length > 1) {
      variantListEl.innerHTML = '';
      // Sort by label (ilvl) ascending
      labeled.sort((a: any, b: any) => {
        const aNum = parseInt(a.label, 10);
        const bNum = parseInt(b.label, 10);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.label.localeCompare(b.label);
      });
      for (const v of labeled) {
        const row = document.createElement('div');
        row.className = 'variant-row';
        // Base-type labels are item levels; unique labels are variant names.
        const label = /^\d+$/.test(String(v.label)) ? `ilvl ${v.label}` : v.label;
        row.textContent = `${label}: ${formatPrice(v.chaos)}c`;
        variantListEl.appendChild(row);
      }
      variantListEl.style.display = 'block';
    } else {
      variantListEl.style.display = 'none';
    }

    listingsEl.textContent = `~${price.totalListings} listings`;
  } else {
    priceSection.style.display = 'none';
    noPriceEl.style.display = 'block';
  }
});

function formatPrice(value: number): string {
  if (value >= 1000) return Math.round(value).toLocaleString();
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}
