// scripts/area-groups.js

function isDublinPostcode(name, start, end) {
    const match = name.match(/^Dublin (\d+|6W), Dublin$/);

    if (!match) return false;

    if (match[1] === "6W") {
        return start <= 6 && end >= 6;
    }

    const num = Number(match[1]);
    return num >= start && num <= end;
}

module.exports = {

    // Dublin 1-10
    dublin1(area) {
        return isDublinPostcode(area.name, 1, 10);
    },

    // Dublin 11-24 (+6W)
    dublin2(area) {
        return (
            isDublinPostcode(area.name, 11, 24) ||
            area.name === "Dublin 6W, Dublin"
        );
    },

    // Dublin 其他地区
    dublin3(area) {
        if (!area.name.endsWith(", Dublin")) return false;

        if (this.dublin1(area)) return false;
        if (this.dublin2(area)) return false;

        return true;
    },

    // Cork
    cork(area) {
        return area.name.endsWith(", Cork");
    },

    // Galway + Limerick
    galway(area) {
        return area.name.endsWith(", Galway");
    },

    // Kildare + Meath + Wicklow
    east(area) {
        return [
            "Kildare (County)",
            "Meath (County)",
            "Wicklow (County)"
        ].includes(area.name);
    },

    // 东南
    southeast(area) {
        return [
            "Waterford (County)",
            "Wexford (County)",
            "Kilkenny (County)",
            "Carlow (County)",
            "Laois (County)",
            "Offaly (County)"
        ].includes(area.name);
    },

    // 西部
    west(area) {
        return [
            "Clare (County)",
            "Kerry (County)",
            "Tipperary (County)",
            "Mayo (County)",
            "Roscommon (County)",
            "Limerick (County)"
        ].includes(area.name);
    },
    
    // 剩余所有
    other(area) {

        const groups = [
            "dublin1",
            "dublin2",
            "dublin3",
            "cork",
            "galway",
            "east",
            "southeast",
            "west"
        ];

        for (const g of groups) {
            if (module.exports[g](area)) {
                return false;
            }
        }

        return true;
    }

};
