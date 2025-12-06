import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";

export default function ServerError() {
  return (
    <Layout>
      <section className="py-24 md:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-md mx-auto text-center">
            <span className="font-display text-8xl md:text-9xl text-red-500/30 block mb-4">
              500
            </span>
            <h1 className="font-display text-3xl md:text-4xl text-white tracking-tight mb-4" data-testid="text-500-title">
              NĚCO SE POS*ALO
            </h1>
            <p className="font-sans text-white/60 mb-8">
              Server spadl jak při pokusu o první boardslide. Zkus to znova.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() => window.location.reload()}
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 group"
                data-testid="button-500-reload"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                ZKUSIT ZNOVU
              </Button>
              <Button
                asChild
                variant="outline"
                className="font-heading text-sm tracking-wider border-zinc-500 text-zinc-200 hover:bg-zinc-800"
              >
                <Link href="/" data-testid="link-500-home">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  ZPĚT DOMŮ
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
