import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insertPaymentSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getJaegerTraceUrl } from "@/lib/trace-utils";
import { DollarSign, User, MessageSquare, Coins, Route, Send, CheckCircle, Loader2 } from "lucide-react";
import type { z } from "zod";

type PaymentFormData = z.infer<typeof insertPaymentSchema>;

export function PaymentForm() {
  // Toggle to control whether browser OTEL injects trace context or not
  const [disableBrowserTrace, setDisableBrowserTrace] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: 1000,
      currency: "USD",
      recipient: "john.doe@example.com",
      description: "Payment for services",
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async (data: PaymentFormData) => {
      // Browser OTEL auto-instruments fetch() and injects traceparent headers
      // If disableBrowserTrace is true, we use a separate fetch to bypass instrumentation

      if (disableBrowserTrace) {
        // Use XMLHttpRequest to bypass OTEL fetch instrumentation
        // This simulates a client without OTEL - Kong will create the trace
        const kongUrl = import.meta.env.VITE_KONG_URL || '';
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${kongUrl}/api/v1/payments`);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              reject(new Error(`Request failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(JSON.stringify(data));
        });
      }

      // Normal path: OTEL auto-injects traceparent header
      const response = await apiRequest("POST", "/api/v1/payments", data);
      return response.json();
    },
    onSuccess: (data) => {
      // Show real OTEL trace ID from the response (not the client-generated one)
      const realTraceId = data.traceId;
      const processorStatus = data.processorResponse?.status || 'pending';
      const processorId = data.processorResponse?.processorId || 'N/A';

      toast({
        title: "Payment Processed",
        description: (
          <div className="space-y-1">
            <p>Trace ID: <code className="bg-slate-100 px-1 rounded">{realTraceId.substring(0, 16)}...</code></p>
            <p>Processor: <span className="font-medium">{processorStatus}</span> ({processorId.split('-')[0]})</p>
            <a
              href={getJaegerTraceUrl(realTraceId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-sm"
            >
              View in Jaeger →
            </a>
            <p className="text-xs text-slate-400">Trace appears in ~3 seconds</p>
          </div>
        ),
      });
      // Invalidate immediately
      queryClient.invalidateQueries({ queryKey: ["/api/v1/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/traces"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/metrics"] });

      // Also refetch after a delay to catch traces that are still being collected
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/v1/traces"] });
      }, 1000);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/v1/traces"] });
      }, 2500);



    },
    onError: (error) => {
      toast({
        title: "Payment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PaymentFormData) => {
    paymentMutation.mutate(data);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-slate-800">Submit Payment Request</CardTitle>
          <Badge variant="secondary" className="text-xs">
            PoC Mode
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Payment Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center text-sm font-medium text-slate-700">
                      <DollarSign className="w-4 h-4 text-slate-400 mr-1" />
                      Amount
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="1000.00"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        className="focus:ring-2 focus:ring-otel-blue focus:border-otel-blue"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center text-sm font-medium text-slate-700">
                      <Coins className="w-4 h-4 text-slate-400 mr-1" />
                      Currency
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="focus:ring-2 focus:ring-otel-blue focus:border-otel-blue">
                          <SelectValue placeholder="Select currency" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="recipient"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-sm font-medium text-slate-700">
                    <User className="w-4 h-4 text-slate-400 mr-1" />
                    Recipient Account
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="john.doe@example.com"
                      {...field}
                      className="focus:ring-2 focus:ring-otel-blue focus:border-otel-blue"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center text-sm font-medium text-slate-700">
                    <MessageSquare className="w-4 h-4 text-slate-400 mr-1" />
                    Description
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Payment for services"
                      {...field}
                      className="focus:ring-2 focus:ring-otel-blue focus:border-otel-blue"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* OpenTelemetry Configuration */}
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center">
                <Route className="w-4 h-4 text-otel-blue mr-2" />
                OpenTelemetry Configuration
              </h3>



              <div className="mb-4 flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-slate-600">Gateway-Initiated Trace</label>
                  <p className="text-xs text-slate-500">Disable browser OTEL (Kong creates trace)</p>
                </div>
                <Switch
                  checked={disableBrowserTrace}
                  onCheckedChange={setDisableBrowserTrace}
                />
              </div>

              {!disableBrowserTrace && (
                <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded p-2">
                  <strong>Browser-initiated trace:</strong> React client creates root span via OTEL instrumentation
                </div>
              )}

              {disableBrowserTrace && (
                <div className="text-center py-3 text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded">
                  <strong>Gateway-initiated trace:</strong> No client OTEL → Kong creates trace context
                </div>
              )}
            </div>

            <Button
              type="submit"
              disabled={paymentMutation.isPending}
              className="w-full bg-otel-blue hover:bg-blue-700 text-white font-medium py-3 px-4 transition-colors"
            >
              {paymentMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : paymentMutation.isSuccess ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Success!
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Submit Payment
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
