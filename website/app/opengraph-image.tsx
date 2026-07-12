import { ImageResponse } from "next/og";

export const alt = "Retree — your state tree, shaped like your component tree";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colors mirror the dark design tokens in globals.css; CSS variables are not
// available inside ImageResponse, so the values are inlined here.
export default function OpenGraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    padding: "80px",
                    backgroundColor: "#0a0d0b",
                    color: "#e9f0ec",
                    fontFamily: "monospace",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        fontSize: 36,
                        color: "#5fe08d",
                    }}
                >
                    <svg
                        width="44"
                        height="44"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#5fe08d"
                        strokeWidth="2"
                        strokeLinecap="round"
                    >
                        <circle cx="12" cy="5" r="2.2" />
                        <circle cx="6" cy="19" r="2.2" />
                        <circle cx="18" cy="19" r="2.2" />
                        <path d="M12 7.5v4m0 0-4.8 5.6M12 11.5l4.8 5.6" />
                    </svg>
                    retree
                </div>
                <div
                    style={{
                        marginTop: 48,
                        fontSize: 68,
                        fontWeight: 700,
                        lineHeight: 1.15,
                        letterSpacing: "-0.02em",
                    }}
                >
                    Your state tree, shaped like your component tree.
                </div>
                <div
                    style={{
                        marginTop: 36,
                        fontSize: 30,
                        color: "#a3b3ab",
                    }}
                >
                    Mutate a plain TypeScript object; exactly the components
                    that read it re-render.
                </div>
                <div
                    style={{
                        marginTop: 56,
                        fontSize: 26,
                        color: "#5fe08d",
                        display: "flex",
                    }}
                >
                    $ npm i @retreejs/core @retreejs/react
                </div>
            </div>
        ),
        size
    );
}
