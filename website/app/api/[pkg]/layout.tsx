import { notFound } from "next/navigation";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import {
    getApiManifest,
    getApiNavigation,
    navPathToSlug,
} from "@/lib/api-docs";

export default async function ApiPackageLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ pkg: string }>;
}) {
    const { pkg } = await params;
    const manifest = await getApiManifest();
    if (!manifest.packages.some((candidate) => candidate.slug === pkg)) {
        notFound();
    }
    const navigation = await getApiNavigation(pkg);

    const sections = [
        {
            title: "Packages",
            items: manifest.packages.map((candidate) => ({
                href: `/api/${candidate.slug}`,
                title: candidate.npmName,
            })),
        },
        ...navigation.map((group) => ({
            title: group.title,
            items: group.children.map((leaf) => ({
                href: `/api/${pkg}/${navPathToSlug(leaf.path).join("/")}`,
                title: leaf.title,
            })),
        })),
    ];

    return (
        <div className="mx-auto flex max-w-7xl gap-10 px-4 py-8 sm:px-6">
            <aside className="hidden w-60 shrink-0 lg:block">
                <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
                    <DocsSidebar sections={sections} />
                </div>
            </aside>
            <div className="min-w-0 flex-1">
                <div className="lg:hidden">
                    <DocsSidebar sections={sections} />
                </div>
                {children}
            </div>
        </div>
    );
}
