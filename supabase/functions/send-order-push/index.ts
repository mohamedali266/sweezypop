import webpush from 'npm:web-push@3.6.7';
import { corsHeaders, getRequesterProfile, jsonResponse } from '../_shared/admin.ts';

const statusCopy = {
  de: {
    new: 'Deine Bestellung wurde angenommen.',
    accepted: 'Deine Bestellung wurde angenommen.',
    preparing: 'Deine Bestellung wird jetzt zubereitet.',
    ready: 'Deine Bestellung ist abholbereit.',
    done: 'Deine Bestellung wurde abgeschlossen.',
    cancelled: 'Deine Bestellung wurde storniert. Bitte frage an der Kasse nach dem Grund.',
  },
  en: {
    new: 'Your order has been received.',
    accepted: 'Your order has been received.',
    preparing: 'Your order is now being prepared.',
    ready: 'Your order is ready for pickup.',
    done: 'Your order has been completed.',
    cancelled: 'Your order was cancelled. Please ask the cashier for the reason.',
  },
} as const;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error:'Method not allowed' }, 405);

  try {
    const { client, profile } = await getRequesterProfile(request);
    if (profile.must_change_password || !['admin', 'owner', 'staff', 'cashier'].includes(profile.role)) throw new Error('Access denied');
    const body = await request.json();
    const orderId = String(body.orderId || '').trim();
    if (!orderId || orderId.length > 120) return jsonResponse({ error:'Invalid order' }, 400);

    const { data:order, error:orderError } = await client
      .from('orders')
      .select('id, restaurant_id, order_number, status, source')
      .eq('id', orderId)
      .eq('restaurant_id', profile.restaurant_id)
      .single();
    if (orderError || !order || order.source !== 'menu') throw new Error('Order not found');

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:notifications@sweezypop.de';
    if (!publicKey || !privateKey) throw new Error('Push service is not configured');
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const { data:subscriptions, error:subscriptionError } = await client
      .from('order_push_subscriptions')
      .select('id, endpoint, p256dh, auth, locale')
      .eq('order_id', orderId);
    if (subscriptionError) throw subscriptionError;

    let delivered = 0;
    const expired:string[] = [];
    await Promise.all((subscriptions || []).map(async subscription => {
      const locale = subscription.locale === 'en' ? 'en' : 'de';
      const copy = statusCopy[locale][order.status as keyof typeof statusCopy.de] || statusCopy[locale].new;
      const payload = JSON.stringify({
        title:locale === 'de' ? `Bestellung #${order.order_number}` : `Order #${order.order_number}`,
        body:copy,
        icon:'/pwa-icon-192.png',
        badge:'/pwa-icon-192.png',
        tag:`order-${order.id}`,
        url:'/',
      });
      try {
        await webpush.sendNotification({ endpoint:subscription.endpoint, keys:{ p256dh:subscription.p256dh, auth:subscription.auth } }, payload, { TTL:3600, urgency:'high' });
        delivered += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?:number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) expired.push(subscription.id);
        else console.error('Push delivery failed', statusCode || 'unknown');
      }
    }));

    if (expired.length) await client.from('order_push_subscriptions').delete().in('id', expired);
    if (['done', 'cancelled'].includes(order.status)) await client.from('order_push_subscriptions').delete().eq('order_id', orderId);
    return jsonResponse({ delivered });
  } catch (error) {
    return jsonResponse({ error:error instanceof Error ? error.message : 'Unknown error' }, 400);
  }
});
