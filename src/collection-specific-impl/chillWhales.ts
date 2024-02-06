import { fetchAssets, fetchFloorPricePer } from '../requests/universalpage';
import { padRight, readFileContent, writeFileContent } from '../utils';
import { Asset, GatherMode, StaticChillWhaleStats } from 'index';
import { isBurntWhaleClaimed, isChillClaimed } from '../requests/onchain';
import { fetchStaticStats } from '../requests/chillwhales';
import { colorMapping, rankColorConfig } from '../config';

import dayjs from 'dayjs';
import chalk from 'chalk';

const chillClaimedCache = JSON.parse(readFileContent('cache', 'chillClaimed.json')) as Record<string, boolean>;
const burntWhalesCache = JSON.parse(readFileContent('cache', 'burntWhaleClaimed.json')) as Record<string, boolean>;

let scores: StaticChillWhaleStats;

async function updateClaimStatus(
    asset: Asset,
    tokenId: string,
    cache: Record<string, boolean>,
    claimType: 'chillClaimed' | 'burntWhaleClaimed',
    checkClaimStatus: (tokenId: string) => Promise<boolean>
) {
    if (cache[tokenId]) {
        asset[claimType] = cache[tokenId];
    } else {
        asset[claimType] = await checkClaimStatus(tokenId);
        if (asset[claimType]) {
            cache[tokenId] = true;
            writeFileContent('cache', `${claimType}.json`, JSON.stringify(cache, null, 2));
        }
    }
}

export async function fetchChillWhalesFloor(assetContract: string) {
    const skins = ['Orca', 'Chrome', 'E.T.', 'Yatted', 'XRay', 'Gold', 'Cypher', 'Pink', 'Zombie', 'Chilly', 'Reptile'];
    const mappedPrice = new Map<string, number>();
    try {
        for (const skin of skins) {
            const price = await fetchFloorPricePer(assetContract, skin);
            if (price !== -1) {
                mappedPrice.set(skin, price);
            }
        }

        let chillUnClaimedFloor = 0;
        let page = 0;
        while (chillUnClaimedFloor === 0) {
            const tempWhales = await fetchChillWhalesAssets(
                assetContract,
                new Map<string, Asset>(),
                'price-low-high',
                page
            );
            const found = tempWhales.find(whale => !whale.chillClaimed);
            if (found) {
                chillUnClaimedFloor = parseInt(found.listingItemPrice, 10) / 1e18;
            } else {
                page++;
            }
        }
        mappedPrice.set('$CHILL', chillUnClaimedFloor);
        const sortedArray = Array.from(mappedPrice).sort((a, b) => a[1] - b[1]);
        const rows: string[] = [];
        for (let i = 0; i < sortedArray.length; i += 4) {
            rows.push(
                sortedArray
                    .slice(i, i + 4)
                    .map(pair => `${padRight(pair[0] + ':', 15)} ${padRight(pair[1] + '', 10)}`)
                    .join('') + '\n'
            );
        }
        return `Floor Prices (last sync: ${dayjs().format('YYYY-MM-DD HH:mm:ss')})\n${rows.join('')}`;
    } catch (error) {
        return `Error fetching floor price: ${error.message}`;
    }
}

export async function fetchChillWhalesAssets(
    assetContract: string,
    assetDetailsMap: Map<string, Asset>,
    gatherMode: GatherMode,
    page = 0
) {
    if (!scores) {
        scores = await fetchStaticStats();
    }
    const assets = await fetchAssets(assetContract, gatherMode, page);
    for (const asset of assets) {
        await updateClaimStatus(asset, asset.tokenId, burntWhalesCache, 'burntWhaleClaimed', isBurntWhaleClaimed);
        await updateClaimStatus(asset, asset.tokenId, chillClaimedCache, 'chillClaimed', isChillClaimed);
        assetDetailsMap.set(asset.tokenId, asset);
    }
    return assets;
}

export function chillWhaleDetails(assetId: string, assetDetailsMap: Map<string, Asset>) {
    const asset = assetDetailsMap.get(assetId);
    const chillClaimed = `${padRight('$CHILL', 12)}: ${padRight(asset.chillClaimed ? 'claimed' : 'unclaimed', 12)}\n`;
    const burntWhaleClaimed = `${padRight('BurntWhale', 12)}: ${padRight(asset.burntWhaleClaimed ? 'claimed' : 'unclaimed', 12)}\n`;
    return (
        chillClaimed +
        burntWhaleClaimed +
        `${'-'.repeat(32)}\n` +
        asset.tokenAttributes
            .map(attr => {
                const rarity = scores.traitsRarity[attr.key][attr.value];
                const value = `${attr.value} (${rarity.toFixed(2)}%)`;
                return `${padRight(attr.key, 12)}: ${padRight(value, 12)}`;
            })
            .join('\n')
    );
}

function getColorByRank(rank: number, config = rankColorConfig) {
    const colorConfig = config.find(configItem => rank <= configItem.maxRank);
    const color = colorConfig ? colorConfig.color : 'grey';
    return colorMapping[color] || chalk.grey; // Default to grey if color not found
}
export function getRank(tokenNumber: number) {
    return Object.keys(scores.whalesScores)
        .sort((a, b) => scores.whalesScores[parseInt(b, 10)] - scores.whalesScores[parseInt(a, 10)])
        .map((mapTokenId, index) => (parseInt(mapTokenId, 10) === tokenNumber ? index + 1 : undefined))
        .find(elem => elem);
}

export function formatChillWhalesListEntry(asset: Asset) {
    const tokenNumber = parseInt(asset.tokenName.split('#')[1], 10);
    const rank = getRank(tokenNumber);
    const price = parseFloat(asset.listingItemPrice) / 1e18;

    const timestamp = dayjs(asset.listingStartAt).format('YYYY-MM-DD HH:mm:ss');
    const tokenNamePadded = padRight(asset.tokenName, 20);
    const rankPadded = padRight(` Rank: ${rank}`, 13);
    const pricePadded = `LYX: ${price.toFixed(2)}`;

    const color = getColorByRank(rank);
    return color(
        `${timestamp}\t${tokenNamePadded} (${asset.chillClaimed ? '-' : '+'} $CHILL)${rankPadded}${pricePadded}`
    );
}
