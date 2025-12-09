import { Link } from "react-router-dom";

const Dashboard = () => {
  return (
    <div className="flex flex-col gap-2">
      <Link to="/cus-konvo">gragh</Link>
      <Link to="/g6">g6</Link>
    </div>
  );
};

export default Dashboard;
