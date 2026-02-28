import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";

export default function NotFound() {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900">
      <Card className="w-full max-w-md mx-4 bg-slate-900/80 border-red-500/30">
        <CardContent className="pt-6 text-center">
          <div className="flex flex-col items-center gap-4 mb-6">
            <div className="p-4 rounded-full bg-red-500/20">
              <AlertCircle className="h-10 w-10 text-red-400" />
            </div>
            <h1 className="text-3xl font-bold text-white">{t('errors.notFound')}</h1>
          </div>

          <p className="text-cyan-100/60 mb-6">
            {t('errors.notFoundDescription')}
          </p>

          <Button
            onClick={() => window.location.href = '/'}
            className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
          >
            <Home className="w-4 h-4 mr-2" />
            {t('buttons.backToHome')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
