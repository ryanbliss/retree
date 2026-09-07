export interface Item {
    id: number;
    name: string;
    score: number;
    tags: { label: string; weight: number }[];
}

export interface Group {
    title: string;
    items: Item[];
}

export function makeTree(
    groups: number,
    itemsPerGroup: number
): { groups: Group[] } {
    const result: { groups: Group[] } = { groups: [] };
    for (let g = 0; g < groups; g++) {
        const items: Item[] = [];
        for (let i = 0; i < itemsPerGroup; i++) {
            items.push({
                id: g * itemsPerGroup + i,
                name: `item-${g}-${i}`,
                score: (g * 31 + i * 7) % 100,
                tags: [
                    { label: "a", weight: i % 5 },
                    { label: "b", weight: g % 3 },
                ],
            });
        }
        result.groups.push({ title: `group-${g}`, items });
    }
    return result;
}

export function scan(root: { groups: Group[] }): number {
    let total = 0;
    for (const group of root.groups) {
        for (const item of group.items) {
            if (item.score > 50) {
                total += item.tags[0].weight + item.tags[1].weight;
            }
            total += item.id % 3;
        }
    }
    return total;
}
