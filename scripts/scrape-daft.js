console.log("Playwright started");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const groups = require("./area-groups");

let AREAS = [];
const GROUP = process.argv[2];

if (!GROUP) {
    console.error("Please specify group.");
    process.exit(1);
}

function normalizePropertyType(type) {

    if (!type) return null;

    type = type.trim();

    const map = {

        "House": "House",

        "Detached": "Detached",

        "Detached House": "Detached",

        "Semi-D": "Semi-Detached",

        "Semi Detached": "Semi-Detached",

        "Semi-Detached": "Semi-Detached",

        "Semi Detached House": "Semi-Detached",

        "Semi-Detached House": "Semi-Detached",

        "Terrace": "Terrace",

        "Terraced House": "Terrace",

        "End of Terrace": "End of Terrace",

        "End of Terrace House": "End of Terrace",

        "Apartment": "Apartment",

        "Apartments": "Apartment",

        "Studio": "Studio",

        "Studio Apartment": "Studio",

        "Duplex": "Duplex",

        "Townhouse": "Townhouse",

        "Town House": "Townhouse",

        "Bungalow": "Bungalow",

        "Site": "Site"

    };

    return map[type] || type;

}

(async () => {
    const startTime = Date.now();

    const HEADLESS =
        process.argv.includes("--headless") ||
        !!process.env.GITHUB_ACTIONS;

        console.log(
            `Launching browser (${HEADLESS ? "Headless" : "Browser"})...`
        );

    const browser = await chromium.launch({

        headless: HEADLESS,

        args: [

            "--no-sandbox",
        
            "--disable-setuid-sandbox",
        
            "--disable-dev-shm-usage",
        
            "--disable-blink-features=AutomationControlled"
        
        ]
    
    });

    console.log("Loading areas.json...");

    AREAS = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "..", "data", "areas.json"),
            "utf8"
        )
    ).filter(area => area.enabled);

    console.log(`Loaded ${AREAS.length} areas.`);

    const SPLIT_COUNTIES = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "..", "data", "sale-split.json"),
            "utf8"
        )
    );

    const crawlAreas = [];

    for (const area of AREAS) {

        // Town
        if (!area.name.endsWith("(County)")) {

            const county = area.name.split(", ").pop();

            if (SPLIT_COUNTIES[`${county} (County)`]) {
                crawlAreas.push(area);
            }

            continue;
        }

        // County 名字
        const county = area.name.replace(" (County)", "");

        // 不需要拆
        if (!SPLIT_COUNTIES[area.name]) {

            crawlAreas.push(area);
            continue;
        }

        // 需要拆，改成抓下面 Town
        const towns = AREAS.filter(a =>
            a.name.endsWith(`, ${county}`)
        );

        crawlAreas.push(...towns);
    }

    console.log(`Sale crawl areas: ${crawlAreas.length}`);

    if (GROUP !== "all") {

        const rule = groups[GROUP];
    
        if (!rule) {
            console.error(`Unknown group: ${GROUP}`);
            process.exit(1);
        }
    
        const before = crawlAreas.length;
    
        const filtered = crawlAreas.filter(rule.bind(groups));
    
        crawlAreas.length = 0;
        crawlAreas.push(...filtered);
    
        console.log(
            `Group: ${GROUP} (${crawlAreas.length}/${before} areas)`
        );
    
    }

    const propertyMap = new Map();

    let failedPages = [];

    let totalListings = 0;
    let duplicateCount = 0;
    let emptyAreas = 0;
    let crawledPages = 0;
    const areaStats = [];
    
    for (const area of crawlAreas) {

        const page = await browser.newPage({
    
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    
            viewport: {
                width: 1920,
                height: 1080
            },
    
            locale: "en-IE",
    
            timezoneId: "Europe/Dublin"
    
        });
    
        await page.setExtraHTTPHeaders({
            "Accept-Language": "en-IE,en;q=0.9"
        });
    
        const baseUrl =
            `https://www.daft.ie/property-for-sale/${area.slug}`;
    
        console.log(`========== ${area.name} ==========`);
    
        try {

            await page.goto(baseUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
        
        } catch (err) {
        
            console.log(`Skip ${area.name}: ${err.message}`);
            await page.close();
            continue;
        
        }
    
        console.log(page.url());
    
        let title = await page.title();

        console.log(title);

        if (
            title.includes("Just a moment") ||
            title.includes("Security Check")
        ) {

            console.log("Cloudflare challenge...");

            await page.waitForTimeout(20000);

            await page.reload({
                waitUntil: "domcontentloaded"
            });

            title = await page.title();

            console.log("After reload:", title);

            if (
                title.includes("Just a moment") ||
                title.includes("Security Check")
            ) {

                console.log("Cloudflare still active.");

            }

        }
    
    console.log(`${area.name} loaded.`);

    console.log("Current URL:", page.url());

    const exists = await page.locator("#__NEXT_DATA__").count();

    console.log(`${area.name}: __NEXT_DATA__ = ${exists}`);

    if (exists === 0) {

        console.log(`${area.name}: Didn't find __NEXT_DATA__`);
    
        console.log("Wait 20 seconds and retry...");
    
        await page.waitForTimeout(20000);
    
        await page.goto(baseUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
    
        const retryExists = await page.locator("#__NEXT_DATA__").count();
    
        console.log(`${area.name}: Retry __NEXT_DATA__ = ${retryExists}`);
    
        if (retryExists === 0) {
    
            console.log(`${area.name}: Still no __NEXT_DATA__, skip.`);
    
            continue;
    
        }
    
    }

    const firstJson = await page.$eval(
        "#__NEXT_DATA__",
        el => JSON.parse(el.textContent)
    );
    
    const totalPages =
        firstJson.props.pageProps.paging.totalPages;

    let areaListings = 0;

    if (totalPages === 0) {
        emptyAreas++;
    }
    
    console.log(`${area.name}: Total pages: ${totalPages}`);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {

        crawledPages++;
    
        let json;
    
        try {
    
            if (pageNum === 1) {
    
                json = firstJson;
    
            } else {

                const url = `${baseUrl}?page=${pageNum}`;

                console.log(`Page ${pageNum}/${totalPages}`);
                
                let success = false;
                
                for (let retry = 0; retry < 3; retry++) {
                
                    try {
                
                        await page.goto(url, {
                            waitUntil: "domcontentloaded",
                            timeout: 60000
                        });
                
                        await page.waitForSelector("#__NEXT_DATA__", {
                            state: "attached",
                            timeout: 20000
                        });
                
                        json = await page.$eval(
                            "#__NEXT_DATA__",
                            el => JSON.parse(el.textContent)
                        );
                
                        success = true;
                        break;
                
                    } catch (err) {
                
                        console.log(
                            `Page ${pageNum} retry ${retry + 1}/3`
                        );
                
                        const retryWaits = [
                            20000,
                            30000,
                            45000
                        ];

                        await page.waitForTimeout(
                            retryWaits[retry]
                        );
                
                    }
                
                }
                
                if (!success) {
                    throw new Error(`Page ${pageNum} failed after 3 retries`);
                }

        }
    
            const listings = json.props.pageProps.listings;
    
            console.log(
                `${area.name} Page ${pageNum}: Found ${listings.length} listings`
            );
    
            const properties = listings.map(item => {

        const p = item.listing;
    
        // =========================
        // 经纬度（Daft 是 [lng, lat]）
        // =========================
    
        const coords = p.point?.coordinates || [];
    
        // =========================
        // 地址拆分
        // =========================
    
        const parts = (p.title || "")
            .split(",")
            .map(s => s.trim());
    
        // 邮编
        const eircode =
            parts.length &&
            /^[A-Z]\d{2}[A-Z0-9]{4}$/i.test(parts[parts.length - 1])
                ? parts.pop()
                : null;
    
        // County
        let county = null;

        if (
            parts.length &&
            parts[parts.length - 1].startsWith("Co. ")
        ) {
            county = parts.pop().replace("Co. ", "");
        }

        // Town
        const town =
            parts.length ? parts.pop() : null;

        // Dublin 特殊处理
        if (!county && town?.startsWith("Dublin")) {
            county = "Dublin";
        }
    
        // Street Address
        const address = parts.join(", ");
    
        // =========================
        // Price
        // =========================
    
        const priceValue = (() => {
    
            if (!p.price) return null;
    
            const number = String(p.price)
                .replace(/[€,]/g, "")
                .replace(/[^\d]/g, "");
    
            return number ? Number(number) : null;
    
        })();
    
        return {
    
            // ==================================
            // 基本
            // ==================================
    
            uid: `daft-sale-${p.id}`,

            group: GROUP,

            source: "daft",

            sourceId: p.id,

            id: p.id,

            title: p.title,
    
            url:
                "https://www.daft.ie" +
                p.seoFriendlyPath,
    
            publishDate:
                p.publishDate || null,
    
            saleType:
                p.saleType?.[0] || null,
    
            listingStatus:
                p.status || "Published",
    
            // ==================================
            // 地址
            // ==================================
    
            address,
    
            town,
    
            county,
    
            eircode,
    
            // ==================================
            // 价格
            // ==================================
    
            price:
                p.price || null,
    
            priceValue,
    
            // ==================================
            // 房屋
            // ==================================
    
            bedrooms:
                parseInt(p.numBedrooms) || null,
    
            bathrooms:
                parseInt(p.numBathrooms) || null,
    
            propertyType:
                normalizePropertyType(p.propertyType),
    
            sections:
                (p.sections || []).filter(
                    s => s !== "Property"
                ),
    
            ber:
                p.ber?.rating?.trim() || null,
    
            floorAreaSqm:
                p.floorArea?.value
                    ? Number(p.floorArea.value)
                    : null,
    
            // ==================================
            // 地图
            // ==================================
    
            lat:
                coords[1] ?? null,
    
            lng:
                coords[0] ?? null,
    
            // ==================================
            // 图片
            // ==================================
    
            image:
                p.media?.images?.[0]?.size720x480 ||
                null,
    
            // ==================================
            // 额外
            // ==================================
    
            featured:
                p.featuredLevel || null,
    
            premierPartner:
                p.premierPartner || false
    
        };
    
    });

    totalListings += properties.length;

    areaListings += properties.length;

    for (const property of properties) {

        if (propertyMap.has(property.uid)) {
            duplicateCount++;
        }
    
        propertyMap.set(property.uid, property);
    
    }

    if (pageNum % 5 === 0 && pageNum < totalPages) {

        console.log(`${area.name}: Cooling down 10 seconds...`);
    
        await page.waitForTimeout(5000);
    
    }

    await page.waitForTimeout(
        3000 + Math.random() * 3000
    );

        } catch (err) {

            failedPages.push(`${area.name} - Page ${pageNum}`);
        
            console.log(`❌ ${area.name} Page ${pageNum} failed`);
        
            console.log(err);
        
            console.log("Cooling down 20 seconds...");
        
            await page.waitForTimeout(20000);
        
            continue;
        
        }

    }

    areaStats.push({
        area: area.name,
        listings: areaListings
    });

    await page.close();
} 

    const allProperties = [...propertyMap.values()];

    // ======================================
    // 保存 JSON
    // ======================================
    
    const dataDir = path.join(
        __dirname,
        "..",
        "data",
        "daft",
        "sale"
    );
    
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const fileName = `daft-sale-${GROUP}.json`;

    const outputFile = path.join(dataDir, fileName);
    
    fs.writeFileSync(
        outputFile,
        JSON.stringify(allProperties, null, 2),
        "utf8"
    );

    // ======================================
    // 更新总库
    // ======================================

    const elapsed = Math.round(
        (Date.now() - startTime) / 1000
    );

    console.log("Area Statistics:");

    for (const stat of areaStats) {

        console.log(`${stat.area}: ${stat.listings}`);

    }
    console.log("========== Summary ==========");

    console.log("");
    
    console.log(`Elapsed: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
    
    console.log(`Average: ${(elapsed / crawledPages).toFixed(2)} sec/page`);
    console.log("");

    console.log(`Areas: ${crawlAreas.length}`);

    console.log(`Pages crawled: ${crawledPages}`);

    console.log(`Empty areas: ${emptyAreas}`);

    console.log(`Total listings: ${totalListings}`);

    console.log(`Duplicates removed: ${duplicateCount}`);

    console.log(`Unique properties: ${allProperties.length}`);

    console.log(`✔ Saved ${allProperties.length} properties`);

    console.log(`📄 data/daft/sale/${fileName}`);

    // ======================================
    // 写入 crawl-summary.json
    // ======================================

    const summaryFile = path.join(
        dataDir,
        "crawl-summary.json"
    );

    let summary = [];

    if (fs.existsSync(summaryFile)) {
        summary = JSON.parse(
            fs.readFileSync(summaryFile, "utf8")
        );
    }

    summary.push({

        group: GROUP,

        success: failedPages.length === 0,

        date: new Date().toLocaleString("sv-SE"),

        elapsed,

        elapsedText: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`,

        areas: crawlAreas.length,

        pages: crawledPages,

        emptyAreas,

        totalListings,

        duplicatesRemoved: duplicateCount,

        uniqueProperties: allProperties.length,

        output: fileName

    });

    fs.writeFileSync(
        summaryFile,
        JSON.stringify(summary, null, 2),
        "utf8"
    );

    console.log(`📄 ${summaryFile}`);
    console.log("✔ crawl-summary.json updated");

    if (failedPages.length) {

        console.log("Failed pages:", failedPages.join(", "));

    } else {

        console.log("All pages completed successfully.");

    }

    await browser.close();
    

})();