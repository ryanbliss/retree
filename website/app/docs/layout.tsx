import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { DOCS_NAV } from "@/lib/docs";

export default function DocsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const sections = DOCS_NAV.map((section) => ({
        title: section.title,
        items: section.items.map((item) => ({
            href: `/docs/${item.slug}`,
            title: item.title,
        })),
    }));

    return (
        <div className="mx-auto flex max-w-7xl gap-10 px-4 py-8 sm:px-6">
            <aside className="hidden w-56 shrink-0 lg:block">
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
