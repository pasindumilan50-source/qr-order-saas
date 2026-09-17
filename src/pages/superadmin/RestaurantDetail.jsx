import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../supabase/config';
import { getRestaurant, setRestaurantStatus } from '../../services/restaurantService';
import { useToast } from '../../context/ToastContext';
import { Loading, Badge, ConfirmDialog } from '../../components/Common';
import { formatDateTime } from '../../utils/formatters';

export default function RestaurantDetail() {
  const { restaurantId } = useParams();
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [orderCount, setOrderCount] = useState(null);
  const [customerCount, setCustomerCount] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  useEffect(() => {
    async function load() {
      try {
        const data = await getRestaurant(restaurantId);
        setRestaurant(data);
        const { count: ordersCount } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId);
        setOrderCount(ordersCount);
        const { count: customersCount } = await supabase
          .from('customers')
          .select('*', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId);
        setCustomerCount(customersCount);
      } catch (err) {
        toast.error('Could not load restaurant details.');
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const handleToggle = async () => {
    try {
      const newStatus = restaurant.status === 'active' ? 'disabled' : 'active';
      await setRestaurantStatus(restaurantId, newStatus);
      setRestaurant((r) => ({ ...r, status: newStatus }));
      toast.success(`Status updated to ${newStatus}.`);
    } catch {
      toast.error('Could not update status.');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return <Loading fullPage label="Loading restaurant…" />;
  if (!restaurant) return <div className="page"><p>Restaurant not found.</p></div>;

  return (
    <div className="page">
      <Link to="/super-admin/restaurants" className="back-link">
        ← Back to restaurants
      </Link>
      <div className="page-header">
        <h1>{restaurant.name}</h1>
        <Badge status={restaurant.status} />
      </div>

      <div className="detail-grid">
        <div className="detail-item">
          <span>Address</span>
          <strong>{restaurant.address || '—'}</strong>
        </div>
        <div className="detail-item">
          <span>Phone</span>
          <strong>{restaurant.phone || '—'}</strong>
        </div>
        <div className="detail-item">
          <span>Email</span>
          <strong>{restaurant.email || '—'}</strong>
        </div>
        <div className="detail-item">
          <span>Created</span>
          <strong>{formatDateTime(restaurant.createdAt)}</strong>
        </div>
        <div className="detail-item">
          <span>Total orders</span>
          <strong>{orderCount ?? '—'}</strong>
        </div>
        <div className="detail-item">
          <span>Total customers</span>
          <strong>{customerCount ?? '—'}</strong>
        </div>
      </div>

      <button className="btn btn-danger" onClick={() => setConfirming(true)}>
        {restaurant.status === 'active' ? 'Disable restaurant' : 'Enable restaurant'}
      </button>

      <ConfirmDialog
        open={confirming}
        title={restaurant.status === 'active' ? 'Disable this restaurant?' : 'Enable this restaurant?'}
        message="This affects their ability to receive orders immediately."
        onConfirm={handleToggle}
        onCancel={() => setConfirming(false)}
        danger={restaurant.status === 'active'}
        confirmLabel={restaurant.status === 'active' ? 'Disable' : 'Enable'}
      />
    </div>
  );
}
